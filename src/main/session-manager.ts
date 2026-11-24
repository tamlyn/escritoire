import { randomUUID } from 'node:crypto'
import {
  type AgentEvent,
  type AgentKind,
  applyEvent,
  emptySessionView,
  type OpenedSession,
  type PastSession,
  type QueuedMessage,
  type RequestResponse,
  type SessionPointer,
  type SessionSettings,
  type SessionSummary,
  type SessionView,
  type SettingChoices,
  type SlashCommand,
  type UserInput,
} from '../shared/agent'
import type { Events } from '../shared/api'
import type { AgentAdapter, AgentRun } from './agents/types'
import { handoffPrompt } from './handoff'
import type { IdeServerConnection } from './ide-server'
import type { SessionRecord, SessionStore } from './session-store'
import { SettingDefaults } from './setting-defaults'
import { Work } from './work'

type ProjectWork = { work: Work; loading: Map<string, Promise<Session>> }

type CommandList = { latest?: SlashCommand[]; loading?: Promise<SlashCommand[]> }

/** An unread session that isn't loaded: left so when the app quit or its project closed. */
type UnreadSession = { projectId: string; pointer: SessionPointer; title: string }

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
  /** Whether a client whose user is present shows it. */
  visible: boolean
  /** Until the first queued message's time comes. */
  waiting?: ReturnType<typeof setTimeout>
}

export type SessionManagerDeps = {
  adapters: Partial<Record<AgentKind, AgentAdapter>>
  store: SessionStore
  /** The model and effort new sessions start with. */
  defaults?: SettingDefaults
  projectPath: (projectId: string) => string
  /** The IDE's MCP server for a project, given to every session the IDE starts. */
  ideConnection?: (projectId: string) => IdeServerConnection
  send: <K extends keyof Events>(name: K, payload: Events[K]) => void
  onSummariesChanged?: (summaries: SessionSummary[]) => void
  now?: () => number
}

const titleLength = 60

/**
 * Owns every loaded session across all projects: runs agents, folds their
 * events into views, tracks attention and forwards events to the renderer.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  /** By agent session id. Replaced by the session once it loads. */
  private readonly unread = new Map<string, UnreadSession>()
  /** Queued messages a client is editing, which wait until it finishes. */
  private readonly heldMessages = new Set<string>()
  /**
   * Where each reset conversation continues, so a client that missed the reset
   * (its tab wasn't mounted, or it wasn't connected) still follows it.
   */
  private readonly moved = new Map<string, string>()
  /** Sessions being forked into a new one, which a second request mustn't fork again. */
  private readonly forking = new Set<string>()
  /** Projects with sessions loading or loaded, until they close. */
  private readonly projects = new Map<string, ProjectWork>()
  /** Never used again, so a late call can't start work for one. */
  private readonly removed = new Set<string>()
  /** By project and agent. */
  private readonly commands = new Map<string, CommandList>()
  private closed = false
  private readonly now: () => number
  private readonly defaults: SettingDefaults

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? Date.now
    this.defaults = deps.defaults ?? SettingDefaults.inMemory()
  }

  private adapter(kind: AgentKind): AgentAdapter {
    const adapter = this.deps.adapters[kind]
    if (!adapter) throw new Error(`Agent unavailable: ${kind}`)
    return adapter
  }

  summaries(): SessionSummary[] {
    const loaded = [...this.sessions.values()].map((s): SessionSummary => ({
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
    const unread = [...this.unread.values()].map((s): SessionSummary => ({
      ...s.pointer,
      projectId: s.projectId,
      title: s.title,
      status: 'idle',
      attention: 'unread',
    }))
    return [...loaded, ...unread]
  }

  /**
   * Sessions load only when a client shows them, so at startup this finds the
   * unread sessions in a project's tabs for the summaries. Sessions without a
   * tab were dismissed. Nothing can be waiting, since agents only resume when
   * sent a message.
   */
  async restoreUnread(projectId: string, tabs: Set<string>): Promise<void> {
    for (const [agentSessionId, record] of Object.entries(await this.deps.store.list(projectId))) {
      if (!tabs.has(agentSessionId) || record.lastTurnEndedAt <= record.lastSeenAt || this.sessions.has(agentSessionId)) continue
      this.unread.set(agentSessionId, { projectId, pointer: { agent: record.agent, agentSessionId }, title: record.title })
    }
    this.broadcastSummaries()
  }

  async listPastSessions(projectId: string): Promise<PastSession[]> {
    const cwd = this.deps.projectPath(projectId)
    const lists = await Promise.allSettled(
      Object.values(this.deps.adapters).map((adapter) => adapter.listSessions(cwd)),
    )
    return lists.flatMap((r) => r.status === 'fulfilled' ? r.value : []).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  createSession(projectId: string, agent: AgentKind): Promise<SessionPointer> {
    return this.project(projectId).work.run(async () => {
      const agentSessionId = await this.adapter(agent).createSession(
        this.deps.projectPath(projectId),
        this.deps.ideConnection?.(projectId),
      )
      await this.deps.store.put(projectId, agentSessionId, { ...newRecord(agent), settings: this.defaults.get(agent) })
      return { agent, agentSessionId }
    })
  }

  async openSession(projectId: string, pointer: SessionPointer): Promise<OpenedSession> {
    const movedTo = this.moved.get(pointer.agentSessionId)
    if (movedTo) return { view: emptySessionView, seq: 0, title: '', draft: '', movedTo }
    const session = await this.load(projectId, pointer)
    this.broadcastSummaries()
    return {
      view: session.view,
      seq: session.seq,
      title: session.record.title,
      draft: session.record.draft,
      movedTo: null,
    }
  }

  async settingChoices(projectId: string, agent: AgentKind): Promise<SettingChoices> {
    return this.adapter(agent).settingChoices(this.deps.projectPath(projectId))
  }

  /**
   * Listing commands starts an agent process, which takes seconds, so this
   * answers with the last list and refreshes it for next time: a skill just
   * added appears the time after.
   */
  listCommands(projectId: string, agent: AgentKind): Promise<SlashCommand[]> {
    const key = `${projectId}\n${agent}`
    let list = this.commands.get(key)
    if (!list) {
      list = {}
      this.commands.set(key, list)
    }
    const current = list
    if (!current.loading) {
      const loading = this.adapter(agent).listCommands(this.deps.projectPath(projectId))
      current.loading = loading
      void loading
        .then((commands) => { current.latest = commands }, () => {})
        .finally(() => { current.loading = undefined })
    }
    return current.latest ? Promise.resolve(current.latest) : current.loading!
  }

  /**
   * Sends the message, or during a turn queues it until the turn ends. Queued
   * here rather than by the agent, so the user can see, edit and cancel it.
   */
  sendMessage(pointer: SessionPointer, input: UserInput): void {
    const session = this.get(pointer)
    session.record.draft = ''
    this.save(session)
    // A message left in the queue is being edited, and this one goes after it.
    if (session.view.status === 'working' || session.view.queued.length > 0) {
      this.setQueue(session, [...session.view.queued, { ...input, id: randomUUID() }])
    } else {
      this.dispatch(session, input)
    }
  }

  /** Warms the existing prompt prefix without clearing the user's draft. */
  async rewarm(pointer: SessionPointer): Promise<void> {
    const session = this.get(pointer)
    if (session.view.status === 'working' || session.view.requests.length || session.view.queued.length) {
      throw new Error('Finish the current turn and queued messages before rewarming.')
    }
    await this.ensureRun(session).rewarm()
  }

  /** Queues the message to go no sooner than `sendAt`, as when continuing once a usage limit resets. */
  scheduleMessage(pointer: SessionPointer, input: UserInput, sendAt: number): void {
    const session = this.get(pointer)
    this.setQueue(session, [...session.view.queued, { ...input, id: randomUUID(), sendAt }])
    if (session.view.status !== 'working') this.sendQueued(session)
  }

  /**
   * Continues the conversation from just before one of the user's messages,
   * with that message changed, as a new session that clients showing this one
   * follow. The original stays as it was, to resume from past sessions.
   */
  async editMessage(pointer: SessionPointer, itemId: string, text: string): Promise<void> {
    const session = this.get(pointer)
    if (session.view.status === 'working') throw new Error('Stop the agent before editing a message.')
    const item = session.view.items.find((candidate) => candidate.id === itemId)
    if (item?.kind !== 'userMessage') throw new Error('Only your own messages can be edited.')
    const { projectId, record } = session
    await this.forkOnce(session, async () => {
      const agentSessionId = await this.project(projectId).work.run(async () => {
        const id = await this.adapter(pointer.agent).forkSession(session.cwd, pointer.agentSessionId, itemId, this.deps.ideConnection?.(projectId))
        await this.deps.store.put(projectId, id, { ...newRecord(pointer.agent), title: record.title, draft: record.draft, settings: record.settings })
        return id
      })
      const fork = await this.load(projectId, { agent: pointer.agent, agentSessionId })
      this.dispatch(fork, { text, images: item.images ?? [] })
      // Sent rather than applied, which would move this session to the new id rather than leave it be.
      session.seq++
      this.deps.send('sessionEvent', { agentSessionId: pointer.agentSessionId, seq: session.seq, event: { type: 'conversationReset', agentSessionId } })
      this.stop(session)
    })
  }

  /**
   * Starts a new session with a hand-off from this one in its draft, for the
   * user to add their next instruction to, and clients showing this one follow.
   * Once the prompt cache has expired that costs far less than resuming. The
   * original stays as it was, to resume from past sessions.
   */
  async continueInNewSession(pointer: SessionPointer): Promise<void> {
    const session = this.get(pointer)
    const { view, projectId, record } = session
    if (view.status === 'working' || view.requests.length || view.queued.length) {
      throw new Error('Finish the current turn and queued messages before continuing in a new session.')
    }
    const draft = handoffPrompt(pointer, view.items) + record.draft
    await this.forkOnce(session, async () => {
      const agentSessionId = await this.project(projectId).work.run(async () => {
        const id = await this.adapter(pointer.agent).createSession(session.cwd, this.deps.ideConnection?.(projectId))
        await this.deps.store.put(projectId, id, { ...newRecord(pointer.agent), title: record.title, draft, settings: record.settings })
        return id
      })
      // Sent rather than applied, as in editMessage.
      session.seq++
      this.deps.send('sessionEvent', { agentSessionId: pointer.agentSessionId, seq: session.seq, event: { type: 'conversationReset', agentSessionId } })
      this.stop(session)
    })
  }

  /** Two clients, or one resending after a reconnect, would otherwise each make a new session. */
  private async forkOnce(session: Session, fork: () => Promise<void>): Promise<void> {
    const id = session.pointer.agentSessionId
    if (this.forking.has(id)) throw new Error('This session is already moving to a new one.')
    this.forking.add(id)
    try {
      await fork()
    } finally {
      this.forking.delete(id)
    }
  }

  editQueuedMessage(pointer: SessionPointer, id: string, text: string): void {
    const session = this.get(pointer)
    this.setQueue(session, session.view.queued.map((message) => (message.id === id ? { ...message, text } : message)))
  }

  cancelQueuedMessage(pointer: SessionPointer, id: string): void {
    const session = this.get(pointer)
    this.setQueue(session, session.view.queued.filter((message) => message.id !== id))
    // Messages sent while it waited for its time were queued behind it.
    if (session.view.status !== 'working') this.sendQueued(session)
  }

  /** Keeps a message from being sent while a client edits it, so the edit can't arrive too late. */
  setQueuedMessageHeld(pointer: SessionPointer, id: string, held: boolean): void {
    if (held) {
      this.heldMessages.add(id)
      return
    }
    this.heldMessages.delete(id)
    const session = this.following(pointer)
    if (session && session.view.status !== 'working') this.sendQueued(session)
  }

  private setQueue(session: Session, queued: QueuedMessage[]): void {
    this.apply(session, { type: 'queueChanged', queued })
  }

  /** Whatever ended the turn, including an interruption or a failure, the next queued message goes. */
  private sendQueued(session: Session): void {
    const [next, ...rest] = session.view.queued
    if (!next || this.heldMessages.has(next.id)) return
    const wait = (next.sendAt ?? 0) - this.now()
    if (wait > 0) {
      // Checked at least each minute, since a timer stands still while the computer sleeps.
      clearTimeout(session.waiting)
      session.waiting = setTimeout(() => {
        if (this.sessions.get(session.pointer.agentSessionId) === session && session.view.status !== 'working') this.sendQueued(session)
      }, Math.min(wait, 60_000))
      return
    }
    this.setQueue(session, rest)
    this.dispatch(session, { text: next.text, images: next.images })
  }

  private dispatch(session: Session, input: UserInput): void {
    const { pointer } = session
    // A placeholder until the agent names the session. Sessions resumed from
    // elsewhere keep the title the agent gave them.
    if (!session.record.title && !session.hadHistory) {
      session.record.title = titleFrom(input.text) || 'Image'
      this.save(session)
    }
    this.ensureRun(session).send(input)
  }

  private ensureRun(session: Session): AgentRun {
    session.run ??= this.adapter(session.pointer.agent).start(
      {
        cwd: session.cwd,
        agentSessionId: session.pointer.agentSessionId,
        settings: session.record.settings ?? {},
        ide: this.deps.ideConnection?.(session.projectId),
        usage: session.view.usage,
      },
      (event) => this.apply(session, event),
    )
    return session.run
  }

  /**
   * Applies the user's choice to the current run, if there is one, and
   * remembers it for the next, and for new sessions if it's to be the default.
   * A choice the run refuses is forgotten.
   */
  async changeSettings(pointer: SessionPointer, settings: SessionSettings, asDefault = false): Promise<void> {
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
    if (asDefault) this.defaults.remember(pointer.agent, settings)
    this.apply(session, { type: 'settingsChanged', settings })
  }

  /**
   * Starting the run here also means the next message doesn't wait for the
   * agent to start. A run that failed waits for the next message to try again.
   */
  async refreshUsage(pointer: SessionPointer): Promise<void> {
    const session = this.get(pointer)
    if (!session.run && session.view.status === 'errored') return
    await this.ensureRun(session).refreshUsage()
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

  /**
   * The user closed the session's tab, so it no longer needs them: marked seen,
   * or it would be unread again after every restart.
   */
  closeSession(pointer: SessionPointer): void {
    const session = this.sessions.get(pointer.agentSessionId)
    if (session) {
      if (session.record.lastSeenAt < session.record.lastTurnEndedAt) {
        session.record.lastSeenAt = this.now()
        this.save(session)
      }
      this.stop(session)
      return
    }
    // Still loading, so it can only be closed once it has.
    for (const project of this.projects.values()) {
      const loading = project.loading.get(pointer.agentSessionId)
      if (!loading) continue
      void loading.catch(() => {}).then(() => this.closeSession(pointer))
      return
    }
    const unread = this.unread.get(pointer.agentSessionId)
    if (!unread || this.removed.has(unread.projectId)) return
    this.unread.delete(pointer.agentSessionId)
    this.broadcastSummaries()
    const { projectId } = unread
    const seenAt = this.now()
    this.project(projectId).work
      .run(async () => {
        const record = await this.deps.store.get(projectId, pointer.agentSessionId)
        if (record) await this.deps.store.put(projectId, pointer.agentSessionId, { ...record, lastSeenAt: seenAt })
      })
      .catch((error: unknown) => console.error(error))
  }

  private stop(session: Session): void {
    const { pointer } = session
    clearTimeout(session.waiting)
    session.run?.close()
    this.adapter(pointer.agent).closeSession?.(pointer.agentSessionId)
    this.sessions.delete(pointer.agentSessionId)
    this.broadcastSummaries()
  }

  /**
   * Stops the project's agents, cancels its loads and waits for its saves.
   * Its unread sessions stay listed, as they would after a restart.
   */
  async closeProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId)
    this.projects.delete(projectId)
    const closing = [...this.sessions.values()].filter((session) => session.projectId === projectId)
    for (const { pointer, record } of closing) {
      if (record.lastTurnEndedAt > record.lastSeenAt) {
        this.unread.set(pointer.agentSessionId, { projectId, pointer, title: record.title })
      }
    }
    for (const session of closing) this.stop(session)
    await project?.work.close()
    // Saved once more in case an earlier save failed.
    await Promise.all(closing.map((session) =>
      this.deps.store.put(session.projectId, session.pointer.agentSessionId, session.record)))
  }

  /** Closes the project for good, so unlike closing it, its unread sessions and records go too. */
  async removeProject(projectId: string): Promise<void> {
    this.removed.add(projectId)
    try {
      await this.closeProject(projectId)
    } finally {
      for (const [id, unread] of this.unread) if (unread.projectId === projectId) this.unread.delete(id)
      this.broadcastSummaries()
      await this.deps.store.deleteProject(projectId)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const results = await Promise.allSettled([...this.projects.keys()].map((projectId) => this.closeProject(projectId)))
    for (const adapter of Object.values(this.deps.adapters)) adapter.dispose?.()
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private apply(session: Session, event: AgentEvent): void {
    const before = session.view
    session.view = applyEvent(before, event)
    session.seq++
    // Sent to whichever clients show the session.
    this.deps.send('sessionEvent', { agentSessionId: session.pointer.agentSessionId, seq: session.seq, event })
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
    const contextWindow = event.type === 'usageChanged' ? event.usage.contextWindow : undefined
    if (contextWindow && contextWindow !== session.record.contextWindow) {
      session.record.contextWindow = contextWindow
      this.save(session)
    }
    if (event.type === 'conversationReset') this.moveTo(session, event.agentSessionId)
    if (event.type === 'titleChanged') {
      if (event.title === session.record.title) return
      session.record.title = event.title
      this.save(session)
    }
    if (event.type !== 'itemUpserted' && event.type !== 'textAppended') this.broadcastSummaries()
    if (event.type === 'statusChanged' && event.status !== 'working') this.sendQueued(session)
  }

  /**
   * Continues the run as the agent's new session. The old session's record stays
   * for when it is resumed, though until the app restarts opening it leads to
   * the new one. Clients follow by opening the new one.
   */
  private moveTo(session: Session, agentSessionId: string): void {
    this.moved.set(session.pointer.agentSessionId, agentSessionId)
    this.sessions.delete(session.pointer.agentSessionId)
    session.pointer = { ...session.pointer, agentSessionId }
    session.record = { ...newRecord(session.pointer.agent), draft: session.record.draft, settings: session.record.settings }
    session.hadHistory = false
    session.visible = false
    this.sessions.set(agentSessionId, session)
    this.save(session)
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
    const project = this.project(projectId)
    let loading = project.loading.get(id)
    if (!loading) {
      loading = project.work
        .run((signal) => this.loadUncached(projectId, pointer, signal))
        .finally(() => project.loading.delete(id))
      project.loading.set(id, loading)
    }
    return loading
  }

  private async loadUncached(projectId: string, pointer: SessionPointer, signal: AbortSignal): Promise<Session> {
    const cwd = this.deps.projectPath(projectId)
    const record =
      (await this.deps.store.get(projectId, pointer.agentSessionId)) ?? newRecord(pointer.agent)
    // Sessions from before efforts were always chosen take the latest choice;
    // `null` was chosen, for a model without efforts.
    const { effort } = this.defaults.get(pointer.agent)
    const settings = { ...(effort ? { effort } : {}), ...record.settings }
    record.settings = settings
    let view: SessionView
    try {
      const history = await this.adapter(pointer.agent).loadHistory(pointer.agentSessionId, cwd)
      const usage = history.usage && { ...history.usage, contextWindow: history.usage.contextWindow ?? record.contextWindow }
      view = { ...emptySessionView, ...history, usage, settings: { ...history.settings, ...settings } }
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
      visible: false,
    }
    signal.throwIfAborted()
    this.sessions.set(pointer.agentSessionId, session)
    this.unread.delete(pointer.agentSessionId)
    return session
  }

  private project(projectId: string): ProjectWork {
    if (this.closed) throw new Error('Closed')
    if (this.removed.has(projectId)) throw new Error('The project has been removed.')
    let project = this.projects.get(projectId)
    if (!project) {
      project = { work: new Work(), loading: new Map() }
      this.projects.set(projectId, project)
    }
    return project
  }

  private get(pointer: SessionPointer): Session {
    const session = this.sessions.get(pointer.agentSessionId)
    if (!session) throw new Error(`Session not open: ${pointer.agentSessionId}`)
    return session
  }

  /** The session now, which a reset may have given a new id since the client last heard. */
  private following(pointer: SessionPointer): Session | undefined {
    let id = pointer.agentSessionId
    for (let next = this.moved.get(id); next; next = this.moved.get(id)) id = next
    return this.sessions.get(id)
  }

  private save(session: Session): void {
    // A closed project's sessions were saved as it closed, and its agents' late events don't matter.
    const project = this.projects.get(session.projectId)
    if (!project) return
    // Captured now, since a reset can give the session a new id and record before the save runs.
    const { agentSessionId } = session.pointer
    const { record } = session
    project.work
      .run(() => this.deps.store.put(session.projectId, agentSessionId, record))
      .catch((error: unknown) => {
        this.apply(session, { type: 'itemUpserted', item: { kind: 'notice', id: 'persistence-error', level: 'error', text: `Couldn't save session: ${errorText(error)}` } })
      })
  }

  private broadcastSummaries(): void {
    const summaries = this.summaries()
    this.deps.send('sessionsChanged', summaries)
    this.deps.onSummariesChanged?.(summaries)
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
