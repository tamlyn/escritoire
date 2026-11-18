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
  SessionSettings,
  SessionSummary,
  SettingChoices,
  SlashCommand,
  UserInput,
} from './agent'
import type { DirectoryEntry, FileContent, FilesChanged, WriteResult } from './files'
import type {
  GitBlame,
  GitBranch,
  GitCommitDetail,
  GitDiff,
  GitDiffRequest,
  GitHistory,
  GitSummary,
} from './git'
import type { ProcessInfo, ProcessSpec } from './process'
import type { PushSubscription, RemoteAccess } from './remote'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from './screen'
import type { Connection, ProjectConnections, StatementResult } from './sql'

/**
 * Everything a client can ask of the main process, over the WebSocket
 * protocol in `api-client.ts`. Values must come through JSON unchanged.
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
  /** Starts or resumes the agent if it isn't running. During a turn the message is queued. */
  sendMessage(session: SessionPointer, input: UserInput): Promise<void>
  editQueuedMessage(session: SessionPointer, id: string, text: string): Promise<void>
  cancelQueuedMessage(session: SessionPointer, id: string): Promise<void>
  /** While held, as when the user is editing it, the message isn't sent even if the turn ends. */
  setQueuedMessageHeld(session: SessionPointer, id: string, held: boolean): Promise<void>
  interrupt(session: SessionPointer): Promise<void>
  getSettingChoices(projectId: string, agent: AgentKind): Promise<SettingChoices>
  listCommands(projectId: string, agent: AgentKind): Promise<SlashCommand[]>
  /** Only the settings given change; `null` goes back to the agent's default. */
  changeSessionSettings(session: SessionPointer, settings: SessionSettings): Promise<void>
  stopTask(session: SessionPointer, taskId: string): Promise<void>
  respond(session: SessionPointer, requestId: string, response: RequestResponse): Promise<void>
  saveDraft(session: SessionPointer, draft: string): Promise<void>
  /** Whether the user can currently see the session, which marks its turns as read. */
  setSessionVisible(session: SessionPointer, visible: boolean): Promise<void>
  /** Stops the agent; the session stays available to resume. */
  closeSession(session: SessionPointer): Promise<void>

  listDirectory(projectId: string, path: string): Promise<DirectoryEntry[]>
  readFile(projectId: string, path: string): Promise<FileContent>
  /** Overwrites the file; `missing` if it no longer exists, since saving never creates files. */
  writeFile(projectId: string, path: string, text: string, expected?: string): Promise<WriteResult>
  /** Creates an empty file and any directories it needs; fails if it exists. */
  createFile(projectId: string, path: string): Promise<void>
  /** Creates an empty file in `.scratch/`, named for the time, and returns its path. */
  createScratchFile(projectId: string, extension: string): Promise<string>
  /** Moves a file or directory, and the SQL connections of the files it moves; fails if the target exists. */
  renameFile(projectId: string, from: string, to: string): Promise<void>
  /** Moves a file or directory to the trash. */
  deleteFile(projectId: string, path: string): Promise<void>
  /** Every file in the project that git doesn't ignore, as relative paths. */
  listProjectFiles(projectId: string): Promise<string[]>

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

  /** `null` if the project isn't in a git repository. */
  getGitSummary(projectId: string): Promise<GitSummary | null>
  getGitDiff(projectId: string, request: GitDiffRequest): Promise<GitDiff>
  /** `null` if the project isn't in a git repository. */
  getGitHistory(projectId: string): Promise<GitHistory | null>
  getGitCommit(projectId: string, hash: string): Promise<GitCommitDetail>
  /** Blames `text`, the file as the editor has it, so lines match while it's being edited. */
  getGitBlame(projectId: string, path: string, text: string): Promise<GitBlame | null>
  /** The file as last committed: empty if only added, `null` if untracked or not text. */
  getGitHeadText(projectId: string, path: string): Promise<string | null>
  switchGitBranch(projectId: string, branch: Pick<GitBranch, 'kind' | 'name'>): Promise<void>
  pullGit(projectId: string): Promise<void>
  pushGit(projectId: string): Promise<void>

  listConnections(projectId: string): Promise<ProjectConnections>
  /**
   * Adds the connection, or replaces the one with its id, closing it if open.
   * A password in a Postgres URL is moved to `~/.pgpass` rather than saved.
   */
  saveConnection(projectId: string, connection: Connection): Promise<ProjectConnections>
  deleteConnection(projectId: string, connectionId: string): Promise<ProjectConnections>
  setFileConnection(projectId: string, path: string, connectionId: string): Promise<ProjectConnections>
  /** Runs the statements in order on the connection, stopping after the first error. */
  runSql(projectId: string, connectionId: string, runId: string, statements: string[]): Promise<StatementResult[]>
  cancelSql(runId: string): Promise<void>

  getRemoteAccess(): Promise<RemoteAccess>
  /** Turning it off, or changing the port, disconnects every paired device. */
  changeRemoteAccess(settings: Pick<RemoteAccess, 'enabled' | 'port'>): Promise<RemoteAccess>
  /** Shows a new pairing code, replacing any other. */
  startPairing(): Promise<RemoteAccess>
  revokeDevice(deviceId: string): Promise<RemoteAccess>
  /** Runs `tailscale serve` for the listener. */
  publishRemoteAccess(): Promise<RemoteAccess>
  /** For a paired device: the public key its push subscription must be made with. */
  getPushKey(): Promise<string>
  /** For a paired device: where to send its notifications. */
  setPushSubscription(subscription: PushSubscription | null): Promise<void>
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
  editQueuedMessage: true,
  cancelQueuedMessage: true,
  setQueuedMessageHeld: true,
  interrupt: true,
  getSettingChoices: true,
  listCommands: true,
  changeSessionSettings: true,
  stopTask: true,
  respond: true,
  saveDraft: true,
  setSessionVisible: true,
  closeSession: true,
  listDirectory: true,
  readFile: true,
  writeFile: true,
  createFile: true,
  createScratchFile: true,
  renameFile: true,
  deleteFile: true,
  listProjectFiles: true,
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
  getGitSummary: true,
  getGitDiff: true,
  getGitHistory: true,
  getGitCommit: true,
  getGitBlame: true,
  getGitHeadText: true,
  switchGitBranch: true,
  pullGit: true,
  pushGit: true,
  listConnections: true,
  saveConnection: true,
  deleteConnection: true,
  setFileConnection: true,
  runSql: true,
  cancelSql: true,
  getRemoteAccess: true,
  changeRemoteAccess: true,
  startPairing: true,
  revokeDevice: true,
  publishRemoteAccess: true,
  getPushKey: true,
  setPushSubscription: true,
}

export const apiMethods = Object.keys(apiMethodSet) as (keyof Api)[]

/** Everything the main process pushes to clients. */
export type Events = {
  sessionsChanged: SessionSummary[]
  sessionEvent: SessionEvent
  /** Only for projects that are some client's active one, which are the only ones watched. */
  filesChanged: FilesChanged
  /** Terminals and processes, keyed by terminal or process id. */
  screenOutput: ScreenOutput
  /** Every project's processes, whenever one changes. */
  processesChanged: ProcessInfo[]
  /** A watched project's files or git state may have changed: a hint to ask again. */
  gitChanged: { projectId: string }
  /** The projects, or this client's active one, changed because of another client. */
  stateChanged: AppState
  remoteAccessChanged: RemoteAccess
  /** The user clicked a notification about the session: show it. Desktop only. */
  focusSession: { projectId: string; pointer: SessionPointer; title: string }
}

const eventNameSet: Record<keyof Events, true> = {
  sessionsChanged: true,
  sessionEvent: true,
  filesChanged: true,
  screenOutput: true,
  processesChanged: true,
  gitChanged: true,
  stateChanged: true,
  remoteAccessChanged: true,
  focusSession: true,
}

export const eventNames = Object.keys(eventNameSet) as (keyof Events)[]

export type EventSubscriber = <K extends keyof Events>(
  name: K,
  listener: (payload: Events[K]) => void,
) => () => void
