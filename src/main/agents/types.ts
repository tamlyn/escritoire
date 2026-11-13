import type {
  AgentEvent,
  AgentKind,
  PastSession,
  RequestResponse,
  SessionSettings,
  SessionView,
  SettingChoices,
  UserInput,
} from '../../shared/agent'
import type { IdeServerConnection } from '../ide-server'

export interface AgentAdapter {
  kind: AgentKind
  /** Returns the agent's id for a session that has not started yet. */
  createSession(cwd: string): Promise<string>
  listSessions(cwd: string): Promise<PastSession[]>
  /** Empty if the session has no transcript yet. */
  loadHistory(agentSessionId: string, cwd: string): Promise<History>
  settingChoices(cwd: string): Promise<SettingChoices>
  start(options: StartOptions, emit: (event: AgentEvent) => void): AgentRun
}

export type History = Pick<SessionView, 'items' | 'usage'>

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
  /** During a turn the message is queued for the agent to pick up. */
  send(input: UserInput): void
  interrupt(): Promise<void>
  respond(requestId: string, response: RequestResponse): void
  /** Applies from the next request; only the settings given change. */
  changeSettings(settings: SessionSettings): Promise<void>
  stopTask(taskId: string): Promise<void>
  close(): void
}
