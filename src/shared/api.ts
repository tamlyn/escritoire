export type Project = {
  id: string
  path: string
  name: string
  isOpen: boolean
  lastActiveAt: number
}

export type AppState = {
  projects: Project[]
  activeProjectId: string | null
}

import type {
  AgentKind,
  OpenedSession,
  PastSession,
  RequestResponse,
  SessionEvent,
  SessionPointer,
  SessionSummary,
} from './agent'
import type { DirectoryEntry, FileContent, FilesChanged, WriteResult } from './files'
import type { ProcessInfo, ProcessSpec } from './process'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from './screen'

/**
 * Everything the renderer can ask of the main process. Each method is one
 * `ipcRenderer.invoke` channel of the same name.
 */
export type Api = {
  getState(): Promise<AppState>
  /** Adds the directory as a project if it isn't one already, then activates it. */
  openProject(path: string): Promise<AppState>
  activateProject(id: string): Promise<AppState>
  /** Releases the project's runtime but keeps its layout for reopening. */
  closeProject(id: string): Promise<AppState>
  /** Closes the project and forgets its layout. */
  removeProject(id: string): Promise<AppState>
  loadLayout(projectId: string): Promise<unknown>
  saveLayout(projectId: string, layout: unknown): Promise<void>
  /** Directories matching a partially typed path, for completion in the project switcher. */
  completeDirectory(partialPath: string): Promise<string[]>

  getSessionSummaries(): Promise<SessionSummary[]>
  listPastSessions(projectId: string): Promise<PastSession[]>
  createSession(projectId: string, agent: AgentKind): Promise<SessionPointer>
  /** Loads the session if needed and subscribes to its `sessionEvent`s. */
  openSession(projectId: string, session: SessionPointer): Promise<OpenedSession>
  closeSessionView(session: SessionPointer): Promise<void>
  /** Starts or resumes the agent if it isn't running. */
  sendMessage(session: SessionPointer, text: string): Promise<void>
  interrupt(session: SessionPointer): Promise<void>
  respond(session: SessionPointer, requestId: string, response: RequestResponse): Promise<void>
  saveDraft(session: SessionPointer, draft: string): Promise<void>
  /** Whether the user can currently see the session, which marks its turns as read. */
  setSessionVisible(session: SessionPointer, visible: boolean): Promise<void>
  /** Stops the agent; the session stays available to resume. */
  closeSession(session: SessionPointer): Promise<void>

  listDirectory(projectId: string, path: string): Promise<DirectoryEntry[]>
  readFile(projectId: string, path: string): Promise<FileContent>
  /** Overwrites the file; `missing` if it no longer exists, since the IDE never creates files. */
  writeFile(projectId: string, path: string, text: string): Promise<WriteResult>

  /** Starts the terminal's shell if needed and sends its `screenOutput` until detached. */
  attachTerminal(projectId: string, terminalId: string, size: ScreenSize): Promise<ScreenSnapshot>
  detachTerminal(terminalId: string): Promise<void>
  writeTerminal(terminalId: string, data: string): Promise<void>
  resizeTerminal(terminalId: string, size: ScreenSize): Promise<void>
  /** Stops the shell and discards the terminal's saved scrollback. */
  closeTerminal(projectId: string, terminalId: string): Promise<void>

  /** Every project's processes. */
  listProcesses(): Promise<ProcessInfo[]>
  /** Returns the running instance rather than starting another. */
  startProcess(projectId: string, spec: ProcessSpec): Promise<ProcessInfo>
  stopProcess(projectId: string, processId: string): Promise<void>
  restartProcess(projectId: string, processId: string): Promise<void>
  /** Forgets a process that has ended. */
  removeProcess(projectId: string, processId: string): Promise<void>
  attachProcess(projectId: string, processId: string, size: ScreenSize): Promise<ScreenSnapshot>
  detachProcess(processId: string): Promise<void>
  writeProcess(projectId: string, processId: string, data: string): Promise<void>
  resizeProcess(projectId: string, processId: string, size: ScreenSize): Promise<void>
}

// A record rather than an array so the compiler rejects a missing or misspelt method.
const apiMethodSet: Record<keyof Api, true> = {
  getState: true,
  openProject: true,
  activateProject: true,
  closeProject: true,
  removeProject: true,
  loadLayout: true,
  saveLayout: true,
  completeDirectory: true,
  getSessionSummaries: true,
  listPastSessions: true,
  createSession: true,
  openSession: true,
  closeSessionView: true,
  sendMessage: true,
  interrupt: true,
  respond: true,
  saveDraft: true,
  setSessionVisible: true,
  closeSession: true,
  listDirectory: true,
  readFile: true,
  writeFile: true,
  attachTerminal: true,
  detachTerminal: true,
  writeTerminal: true,
  resizeTerminal: true,
  closeTerminal: true,
  listProcesses: true,
  startProcess: true,
  stopProcess: true,
  restartProcess: true,
  removeProcess: true,
  attachProcess: true,
  detachProcess: true,
  writeProcess: true,
  resizeProcess: true,
}

export const apiMethods = Object.keys(apiMethodSet) as (keyof Api)[]

/** Everything the main process pushes to the renderer. Each event is one channel of the same name. */
export type Events = {
  sessionsChanged: SessionSummary[]
  sessionEvent: SessionEvent
  /** Only for the active project, which is the only one watched. */
  filesChanged: FilesChanged
  /** Terminals and processes, keyed by terminal or process id. */
  screenOutput: ScreenOutput
  /** Every project's processes, whenever one changes. */
  processesChanged: ProcessInfo[]
}

const eventNameSet: Record<keyof Events, true> = {
  sessionsChanged: true,
  sessionEvent: true,
  filesChanged: true,
  screenOutput: true,
  processesChanged: true,
}

export const eventNames = Object.keys(eventNameSet) as (keyof Events)[]

export type EventSubscriber = <K extends keyof Events>(
  name: K,
  listener: (payload: Events[K]) => void,
) => () => void
