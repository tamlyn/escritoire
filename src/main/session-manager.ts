import {
  type AgentEvent,
  type AgentKind,
  applyEvent,
  emptySessionView,
  type OpenedSession,
  type PastSession,
  type RequestResponse,
  type SessionPointer,
  type SessionSummary,
  type SessionView,
} from '../shared/agent'
import type { Events } from '../shared/api'
import type { AgentAdapter, AgentRun } from './agents/types'
import type { SessionRecord, SessionStore } from './session-store'

type Session = {
  projectId: string
  pointer: SessionPointer
  cwd: string
  record: SessionRecord
  view: SessionView
  seq: number
  /** Whether the agent has a transcript to resume rather than starting fresh. */
  hasHistory: boolean
  run?: AgentRun
  /** The renderer has the session open and wants its events. */
  subscribed: boolean
  visible: boolean
}

export type SessionManagerDeps = {
  adapters: Record<AgentKind, AgentAdapter>
  store: SessionStore
  projectPath: (projectId: string) => string
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
  private readonly loading = new Map<string, Promise<Session>>()
  private readonly now: () => number

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? Date.now
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
    const lists = await Promise.all(
      Object.values(this.deps.adapters).map((adapter) => adapter.listSessions(cwd)),
    )
    return lists.flat().sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  async createSession(projectId: string, agent: AgentKind): Promise<SessionPointer> {
    const agentSessionId = await this.deps.adapters[agent].createSession(
      this.deps.projectPath(projectId),
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

  sendMessage(pointer: SessionPointer, text: string): void {
    const session = this.get(pointer)
    // Sessions resumed from elsewhere keep the title the agent gave them.
    if (!session.record.title && !session.hasHistory) session.record.title = titleFrom(text)
    if (!session.run) {
      session.run = this.deps.adapters[pointer.agent].start(
        { cwd: session.cwd, agentSessionId: pointer.agentSessionId, resume: session.hasHistory },
        (event) => this.apply(session, event),
      )
      session.hasHistory = true
    }
    session.record.draft = ''
    this.save(session)
    session.run.send(text)
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
    this.sessions.delete(pointer.agentSessionId)
    this.broadcastSummaries()
  }

  closeProject(projectId: string): void {
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId) this.closeSession(session.pointer)
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.run?.close()
    this.sessions.clear()
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
      // A failed run can't be reused; the next message starts a new one that resumes.
      if (event.status === 'errored') session.run = undefined
    }
    if (event.type !== 'itemUpserted' && event.type !== 'textAppended') this.broadcastSummaries()
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
    let loading = this.loading.get(id)
    if (!loading) {
      loading = this.loadUncached(projectId, pointer).finally(() => this.loading.delete(id))
      this.loading.set(id, loading)
    }
    return loading
  }

  private async loadUncached(projectId: string, pointer: SessionPointer): Promise<Session> {
    const cwd = this.deps.projectPath(projectId)
    const record =
      (await this.deps.store.get(projectId, pointer.agentSessionId)) ?? newRecord(pointer.agent)
    let view: SessionView = emptySessionView
    try {
      const items = await this.deps.adapters[pointer.agent].loadHistory(pointer.agentSessionId, cwd)
      view = { ...emptySessionView, items }
    } catch (error) {
      view = {
        ...emptySessionView,
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
      hasHistory: view.items.some((item) => item.kind !== 'notice'),
      subscribed: false,
      visible: false,
    }
    this.sessions.set(pointer.agentSessionId, session)
    return session
  }

  private get(pointer: SessionPointer): Session {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) throw new Error(`Session not open: ${pointer.agentSessionId}`)
    return session
  }

  private save(session: Session): void {
    void this.deps.store.put(session.projectId, session.pointer.agentSessionId, session.record)
  }

  private broadcastSummaries(): void {
    this.deps.send('sessionsChanged', this.summaries())
  }
}

function newRecord(agent: AgentKind): SessionRecord {
  return { agent, title: '', draft: '', lastSeenAt: 0, lastTurnEndedAt: 0 }
}

function titleFrom(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? ''
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine
}
