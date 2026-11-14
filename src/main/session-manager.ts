import { randomUUID } from 'node:crypto'
import {
  type AgentEvent,
  type AgentKind,
  applyEvent,
  emptySessionView,
  type OpenedSession,
  type PastSession,
  type RequestResponse,
  type SessionPointer,
  type SessionSettings,
  type SessionSummary,
  type SessionView,
  type SettingChoices,
  type UserInput,
} from '../shared/agent'
import type { Events } from '../shared/api'
import type { AgentAdapter, AgentRun } from './agents/types'
import type { IdeServerConnection } from './ide-server'
import type { SessionRecord, SessionStore } from './session-store'

type Session = {
  projectId: string
  pointer: SessionPointer
  cwd: string
  record: SessionRecord
  view: SessionView
  seq: number
  /** Whether the agent had a transcript when the session was loaded. */
  hadHistory: boolean
  run?: AgentRun
  /** The renderer has the session open and wants its events. */
  subscribed: boolean
  visible: boolean
}

export type SessionManagerDeps = {
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  store: SessionStore
  projectPath: (projectId: string) => string
  /** The IDE's MCP server for a project, given to every session the IDE starts. */
  ideConnection?: (projectId: string) => IdeServerConnection
  send: <K extends keyof Events>(name: K, payload: Events[K]) => void
  now?: () => number
}

const titleLength = 60

/**
 * Owns every loaded session across all projects: runs agents, folds their
 * events into views, tracks attention and forwards events to the renderer.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly generations = new Map<string, number>()
  private readonly pending = new Set<Promise<void>>()

  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending])
    await Promise.all([...this.sessions.values()].map((session) =>
      this.deps.store.put(session.projectId, session.pointer.agentSessionId, session.record)))
  }

  private readonly loading = new Map<string, Promise<Session>>()
  private readonly now: () => number

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? Date.now
  }

  private adapter(kind: AgentKind): AgentAdapter {
    const adapter = this.deps.adapters[kind]
    if (!adapter) throw new Error(`Agent unavailable: ${kind}`)
    return adapter
  }

  summaries(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({
      ...s.pointer,
      projectId: s.projectId,
      title: s.record.title,
      status: s.view.status,
      attention:
        s.view.requests.length > 0
          ? 'waiting'
          : s.record.lastTurnEndedAt > s.record.lastSeenAt
            ? 'unread'
            : null,
    }))
  }

  async listPastSessions(projectId: string): Promise<PastSession[]> {
    const cwd = this.deps.projectPath(projectId)
    const lists = await Promise.allSettled(
      Object.values(this.deps.adapters).map((adapter) => adapter.listSessions(cwd)),
    )
    return lists.flatMap((r) => r.status === 'fulfilled' ? r.value : []).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  async createSession(projectId: string, agent: AgentKind): Promise<SessionPointer> {
    const agentSessionId = await this.adapter(agent).createSession(
      this.deps.projectPath(projectId),
      this.deps.ideConnection?.(projectId),
    )
    await this.deps.store.put(projectId, agentSessionId, newRecord(agent))
    return { agent, agentSessionId }
  }

  async openSession(projectId: string, pointer: SessionPointer): Promise<OpenedSession> {
    const session = await this.load(projectId, pointer)
    session.subscribed = true
    this.broadcastSummaries()
    return {
      view: session.view,
      seq: session.seq,
      title: session.record.title,
      draft: session.record.draft,
    }
  }

  closeSessionView(pointer: SessionPointer): void {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) return
    session.subscribed = false
    session.visible = false
  }

  async settingChoices(projectId: string, agent: AgentKind): Promise<SettingChoices> {
    return this.adapter(agent).settingChoices(this.deps.projectPath(projectId))
  }

  sendMessage(pointer: SessionPointer, input: UserInput): void {
    const session = this.get(pointer)
    // Sessions resumed from elsewhere keep the title the agent gave them.
    if (!session.record.title && !session.hadHistory) {
      session.record.title = titleFrom(input.text) || 'Image'
    }
    session.run ??= this.adapter(pointer.agent).start(
      {
        cwd: session.cwd,
        agentSessionId: pointer.agentSessionId,
        settings: session.record.settings ?? {},
        ide: this.deps.ideConnection?.(session.projectId),
      },
      (event) => this.apply(session, event),
    )
    session.record.draft = ''
    this.save(session)
    session.run.send(input)
  }

  /**
   * Applies the user's choice to the current run, if there is one, and
   * remembers it for the next. A choice the run refuses is forgotten.
   */
  async changeSettings(pointer: SessionPointer, settings: SessionSettings): Promise<void> {
    const session = this.get(pointer)
    try {
      await session.run?.changeSettings(settings)
    } catch (error) {
      this.apply(session, {
        type: 'itemUpserted',
        item: { kind: 'notice', id: randomUUID(), level: 'error', text: `Couldn't change the settings: ${errorText(error)}` },
      })
      return
    }
    this.rememberSettings(session, settings)
    this.apply(session, { type: 'settingsChanged', settings })
  }

  async stopTask(pointer: SessionPointer, taskId: string): Promise<void> {
    await this.get(pointer).run?.stopTask(taskId)
  }

  async interrupt(pointer: SessionPointer): Promise<void> {
    await this.get(pointer).run?.interrupt()
  }

  respond(pointer: SessionPointer, requestId: string, response: RequestResponse): void {
    this.get(pointer).run?.respond(requestId, response)
  }

  saveDraft(pointer: SessionPointer, draft: string): void {
    const session = this.get(pointer)
    session.record.draft = draft
    this.save(session)
  }

  setVisible(pointer: SessionPointer, visible: boolean): void {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) return
    session.visible = visible
    if (visible) this.markSeen(session)
  }

  closeSession(pointer: SessionPointer): void {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) return
    session.run?.close()
    this.adapter(pointer.agent).closeSession?.(pointer.agentSessionId)
    this.sessions.delete(pointer.agentSessionId)
    this.broadcastSummaries()
  }

  closeProject(projectId: string): void {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1)
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId) this.closeSession(session.pointer)
    }
  }

  closeAll(): void {
    for (const [projectId, generation] of this.generations) this.generations.set(projectId, generation + 1)
    for (const session of this.sessions.values()) session.run?.close()
    this.sessions.clear()
    for (const adapter of Object.values(this.deps.adapters)) adapter.dispose?.()
  }

  private apply(session: Session, event: AgentEvent): void {
    const before = session.view
    session.view = applyEvent(before, event)
    session.seq++
    if (session.subscribed) {
      this.deps.send('sessionEvent', {
        agentSessionId: session.pointer.agentSessionId,
        seq: session.seq,
        event,
      })
    }
    if (event.type === 'statusChanged') {
      if (before.status === 'working' && event.status !== 'working') {
        session.record.lastTurnEndedAt = this.now()
        if (session.visible) session.record.lastSeenAt = session.record.lastTurnEndedAt
        this.save(session)
      }
      // A failed run has ended itself; the next message starts a new one.
      if (event.status === 'errored') session.run = undefined
    }
    // The agent can change mode itself, such as leaving plan mode, and the next
    // run should continue in it. Models are reported resolved, so stay as chosen.
    const { permissionMode } = event.type === 'settingsChanged' ? event.settings : {}
    if (permissionMode && permissionMode !== session.record.settings?.permissionMode) {
      this.rememberSettings(session, { permissionMode })
    }
    if (event.type !== 'itemUpserted' && event.type !== 'textAppended') this.broadcastSummaries()
  }

  private rememberSettings(session: Session, settings: SessionSettings): void {
    session.record.settings = { ...session.record.settings, ...settings }
    this.save(session)
  }

  private markSeen(session: Session): void {
    if (session.record.lastSeenAt >= session.record.lastTurnEndedAt) return
    session.record.lastSeenAt = this.now()
    this.save(session)
    this.broadcastSummaries()
  }

  private async load(projectId: string, pointer: SessionPointer): Promise<Session> {
    const id = pointer.agentSessionId
    const existing = this.sessions.get(id)
    if (existing) return existing
    const loadingKey = `${projectId}:${this.generations.get(projectId) ?? 0}:${id}`
    let loading = this.loading.get(loadingKey)
    if (!loading) {
      loading = this.loadUncached(projectId, pointer).finally(() => this.loading.delete(loadingKey))
      this.loading.set(loadingKey, loading)
    }
    return loading
  }

  private async loadUncached(projectId: string, pointer: SessionPointer): Promise<Session> {
    const generation = this.generations.get(projectId) ?? 0
    this.generations.set(projectId, generation)
    const cwd = this.deps.projectPath(projectId)
    const record =
      (await this.deps.store.get(projectId, pointer.agentSessionId)) ?? newRecord(pointer.agent)
    const settings = record.settings ?? {}
    let view: SessionView
    try {
      const history = await this.adapter(pointer.agent).loadHistory(pointer.agentSessionId, cwd)
      view = { ...emptySessionView, ...history, settings: { ...history.settings, ...settings } }
    } catch (error) {
      view = {
        ...emptySessionView,
        settings,
        items: [{ kind: 'notice', id: 'history-error', level: 'error', text: `Couldn't load history: ${String(error)}` }],
      }
    }
    const session: Session = {
      projectId,
      pointer,
      cwd,
      record,
      view,
      seq: 0,
      hadHistory: view.items.some((item) => item.kind !== 'notice'),
      subscribed: false,
      visible: false,
    }
    if ((this.generations.get(projectId) ?? 0) !== generation) throw new Error("Project closed while loading session")
    this.sessions.set(pointer.agentSessionId, session)
    return session
  }

  private get(pointer: SessionPointer): Session {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) throw new Error(`Session not open: ${pointer.agentSessionId}`)
    return session
  }

  private save(session: Session): void {
    const write = this.deps.store.put(session.projectId, session.pointer.agentSessionId, session.record)
    this.pending.add(write)
    void write.then(() => this.pending.delete(write), (error) => {
      this.pending.delete(write)
      this.apply(session, { type: 'itemUpserted', item: { kind: 'notice', id: 'persistence-error', level: 'error', text: `Couldn't save session: ${errorText(error)}` } })
    })
  }

  private broadcastSummaries(): void {
    this.deps.send('sessionsChanged', this.summaries())
  }
}

function newRecord(agent: AgentKind): SessionRecord {
  return { agent, title: '', draft: '', lastSeenAt: 0, lastTurnEndedAt: 0, settings: {} }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function titleFrom(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? ''
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine
}
