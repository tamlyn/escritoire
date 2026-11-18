import type { SessionPointer } from '../shared/agent'
import type { AppState, Events } from '../shared/api'
import type { ScreenSize, ScreenSnapshot } from '../shared/screen'
import type { SendEvent } from './api-server'

/** Terminals or supervised processes: the screens a client can attach to. */
export type ScreenHost = {
  attach(projectId: string, screenId: string, size: ScreenSize): Promise<ScreenSnapshot>
  detach(screenId: string): void
  write(projectId: string, screenId: string, data: string): void
  resize(projectId: string, screenId: string, size: ScreenSize): void
}

export type ClientsDeps = {
  /** The project a new client starts in. */
  lastActiveProject: () => string | null
  isProjectOpen: (projectId: string) => boolean
  /** Whether a client whose user is present can see the session, which marks its turns read. */
  setSessionVisible: (session: SessionPointer, visible: boolean) => void
  /** No client has the session open any more. */
  closeSessionView: (session: SessionPointer) => void
  /** Whether a client is editing the queued message, which keeps it from being sent. */
  setQueuedMessageHeld: (session: SessionPointer, id: string, held: boolean) => void
  /** The projects that are some client's active one, which are the ones watched. */
  watch: (projectIds: string[]) => void
}

type SessionView = { pointer: SessionPointer; visible: boolean }
type Attachment = { host: ScreenHost; projectId: string; size: ScreenSize }

/** One connection: the desktop window, or later a phone or another computer. */
export type Client = {
  readonly send: SendEvent
  /** The desktop's presence comes from the system; other clients report their own visibility. */
  readonly desktop: boolean
  /** The paired device this connection belongs to; `null` for the desktop. */
  readonly deviceId: string | null
  activeProjectId: string | null
  present: boolean
  /** By agent session id. */
  readonly sessions: Map<string, SessionView>
  /** The queued messages this client is editing, by message id. */
  readonly heldMessages: Map<string, SessionPointer>
  /** By screen id, with the size this client wants it. */
  readonly screens: Map<string, Attachment>
}

/**
 * What each connected client has open, and what main's services see of them
 * all together: a session is visible if any present client shows it, and a
 * screen stays attached while any client is. Events go only to clients that
 * want them. A client's state is released when it disconnects.
 */
export class Clients {
  private readonly clients = new Set<Client>()
  /** The size each attached screen was last given. */
  private readonly screenSizes = new Map<string, ScreenSize>()
  private present = true

  constructor(private readonly deps: ClientsDeps) {}

  /** `activeProjectId` is where a reconnecting client was, which doesn't count as activating it. */
  connect(
    send: SendEvent,
    { deviceId = null, activeProjectId = null }: { deviceId?: string | null; activeProjectId?: string | null },
  ): Client {
    const desktop = deviceId === null
    const client: Client = {
      send,
      desktop,
      deviceId,
      activeProjectId: activeProjectId !== null && this.deps.isProjectOpen(activeProjectId) ? activeProjectId : this.deps.lastActiveProject(),
      present: desktop ? this.present : true,
      sessions: new Map(),
      heldMessages: new Map(),
      screens: new Map(),
    }
    this.clients.add(client)
    this.updateWatches()
    return client
  }

  disconnect(client: Client): void {
    if (!this.clients.delete(client)) return
    for (const { pointer } of client.sessions.values()) this.release(pointer)
    for (const [id, pointer] of client.heldMessages) this.deps.setQueuedMessageHeld(pointer, id, false)
    for (const screenId of client.screens.keys()) this.detachScreen(client, screenId)
    this.updateWatches()
  }

  /** Sends session events and screen output only to the clients showing them. */
  readonly send: SendEvent = (name, payload) => {
    for (const client of this.clients) if (wants(client, name, payload)) client.send(name, payload)
  }

  /** Tells the other clients about something this one did, which it already knows. */
  sendToOthers<K extends keyof Events>(sender: Client, name: K, payload: Events[K]): void {
    for (const client of this.clients) if (client !== sender && wants(client, name, payload)) client.send(name, payload)
  }

  /** The app's state as this client sees it. */
  state(client: Client, app: AppState): AppState {
    return { ...app, activeProjectId: client.activeProjectId }
  }

  /** Makes the app's active project this client's, as after it opens or activates one. */
  activate(client: Client, app: AppState): AppState {
    client.activeProjectId = app.activeProjectId
    return this.projectsChanged(app, client)
  }

  /**
   * Tells every client the projects changed. A client whose active project
   * closed moves to the app's, which is the most recently active open one.
   */
  projectsChanged(app: AppState, caller: Client): AppState {
    for (const client of this.clients) {
      if (!app.projects.some((p) => p.id === client.activeProjectId && p.isOpen)) {
        client.activeProjectId = app.activeProjectId
      }
      if (client !== caller) client.send('stateChanged', this.state(client, app))
    }
    this.updateWatches()
    return this.state(caller, app)
  }

  /** Call before opening the session, so events sent while it loads reach the client. */
  openSessionView(client: Client, pointer: SessionPointer): void {
    if (!client.sessions.has(pointer.agentSessionId)) client.sessions.set(pointer.agentSessionId, { pointer, visible: false })
  }

  closeSessionView(client: Client, pointer: SessionPointer): void {
    if (client.sessions.delete(pointer.agentSessionId)) this.release(pointer)
  }

  setSessionVisible(client: Client, pointer: SessionPointer, visible: boolean): void {
    const view = client.sessions.get(pointer.agentSessionId)
    if (!view) return
    view.visible = visible
    this.updateVisibility(pointer)
  }

  setQueuedMessageHeld(client: Client, pointer: SessionPointer, id: string, held: boolean): void {
    if (held) client.heldMessages.set(id, pointer)
    else client.heldMessages.delete(id)
    this.deps.setQueuedMessageHeld(pointer, id, held)
  }

  /** The session has closed, so no client has it open. */
  sessionClosed(pointer: SessionPointer): void {
    for (const client of this.clients) client.sessions.delete(pointer.agentSessionId)
  }

  get desktopPresent(): boolean {
    return this.present
  }

  /** Whether the device has the session on its screen. */
  deviceShows(deviceId: string, agentSessionId: string): boolean {
    return [...this.clients].some((client) => client.deviceId === deviceId && client.present && client.sessions.get(agentSessionId)?.visible)
  }

  setDesktopPresent(present: boolean): void {
    this.present = present
    for (const client of this.clients) {
      if (!client.desktop || client.present === present) continue
      client.present = present
      for (const { pointer } of client.sessions.values()) this.updateVisibility(pointer)
    }
  }

  /** A screen already attached elsewhere keeps its size, so a phone attaching doesn't shrink the desktop's. */
  attachScreen(client: Client, host: ScreenHost, projectId: string, screenId: string, size: ScreenSize): Promise<ScreenSnapshot> {
    const shared = this.attachedClients(screenId).some((other) => other !== client)
    client.screens.set(screenId, { host, projectId, size })
    const given = (shared && this.screenSizes.get(screenId)) || size
    this.screenSizes.set(screenId, given)
    return host.attach(projectId, screenId, given)
  }

  detachScreen(client: Client, screenId: string): void {
    const attachment = client.screens.get(screenId)
    if (!attachment) return
    client.screens.delete(screenId)
    const [remaining] = this.attachedClients(screenId)
    if (remaining) {
      // Fits the screen back to a client still showing it, rather than one that's gone.
      const { size } = remaining.screens.get(screenId)!
      if (!sameSize(size, this.screenSizes.get(screenId))) this.resizeScreen(remaining, screenId, size)
      return
    }
    this.screenSizes.delete(screenId)
    attachment.host.detach(screenId)
  }

  /**
   * Typing takes the screen to this client's size, as resizing does. Only a
   * client attached to the screen is showing it, so only it can type or resize.
   */
  writeScreen(client: Client, screenId: string, data: string): void {
    const attachment = client.screens.get(screenId)
    if (!attachment) return
    if (!sameSize(attachment.size, this.screenSizes.get(screenId))) this.resizeScreen(client, screenId, attachment.size)
    attachment.host.write(attachment.projectId, screenId, data)
  }

  resizeScreen(client: Client, screenId: string, size: ScreenSize): void {
    const attachment = client.screens.get(screenId)
    if (!attachment) return
    attachment.size = size
    this.screenSizes.set(screenId, size)
    attachment.host.resize(attachment.projectId, screenId, size)
  }

  /** The screen has gone, so no client is attached to it. */
  screenClosed(screenId: string): void {
    for (const client of this.clients) client.screens.delete(screenId)
    this.screenSizes.delete(screenId)
  }

  private release(pointer: SessionPointer): void {
    if (this.viewers(pointer).length === 0) this.deps.closeSessionView(pointer)
    else this.updateVisibility(pointer)
  }

  private updateVisibility(pointer: SessionPointer): void {
    const visible = this.viewers(pointer).some((client) => client.present && client.sessions.get(pointer.agentSessionId)!.visible)
    this.deps.setSessionVisible(pointer, visible)
  }

  private viewers(pointer: SessionPointer): Client[] {
    return [...this.clients].filter((client) => client.sessions.has(pointer.agentSessionId))
  }

  private attachedClients(screenId: string): Client[] {
    return [...this.clients].filter((client) => client.screens.has(screenId))
  }

  private updateWatches(): void {
    const projectIds = new Set([...this.clients].map((client) => client.activeProjectId))
    projectIds.delete(null)
    this.deps.watch([...projectIds] as string[])
  }
}

function wants<K extends keyof Events>(client: Client, name: K, payload: Events[K]): boolean {
  if (name === 'sessionEvent') return client.sessions.has((payload as Events['sessionEvent']).agentSessionId)
  if (name === 'screenOutput') return client.screens.has((payload as Events['screenOutput']).screenId)
  // It carries the pairing code.
  if (name === 'remoteAccessChanged') return client.desktop
  // Only the desktop shows notifications.
  if (name === 'focusSession') return client.desktop
  return true
}

function sameSize(a: ScreenSize, b: ScreenSize | undefined): boolean {
  return a.cols === b?.cols && a.rows === b.rows
}
