import type {
  AgentEvent,
  AgentKind,
  PastSession,
  RequestResponse,
  SessionSettings,
  SessionView,
  SettingChoices,
  SlashCommand,
  UserInput,
} from '../../shared/agent'
import type { IdeServerConnection } from '../ide-server'

export interface AgentAdapter {
  kind: AgentKind
  closeSession?(id: string): void
  dispose?(): void
  /** Returns the agent's id for a session that has not started yet. */
  createSession(cwd: string, ide?: IdeServerConnection): Promise<string>
  listSessions(cwd: string): Promise<PastSession[]>
  /** Empty if the session has no transcript yet. */
  loadHistory(agentSessionId: string, cwd: string): Promise<History>
  settingChoices(cwd: string): Promise<SettingChoices>
  listCommands(cwd: string): Promise<SlashCommand[]>
  start(options: StartOptions, emit: (event: AgentEvent) => void): AgentRun
}

export type History = Pick<SessionView, 'items' | 'usage'> & { settings?: SessionSettings }

/** The run continues the session's transcript if the agent has one. */
export type StartOptions = {
  cwd: string
  agentSessionId: string
  settings: SessionSettings
  /** The IDE's MCP server for this project, offered to the agent. */
  ide?: IdeServerConnection
}

/**
 * A running agent process. A run that fails or exits emits `errored` and then
 * nothing more; a closed run emits nothing.
 */
export interface AgentRun {
  /**
   * The session manager holds messages until a turn ends, but the agent may
   * start a turn of its own (when a background task finishes, say), so a
   * message arriving during one is queued for the agent to pick up.
   */
  send(input: UserInput): void
  interrupt(): Promise<void>
  respond(requestId: string, response: RequestResponse): void
  /** Applies from the next request; only the settings given change. */
  changeSettings(settings: SessionSettings): Promise<void>
  stopTask(taskId: string): Promise<void>
  close(): void
}
