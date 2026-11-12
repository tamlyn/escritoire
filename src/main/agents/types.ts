import type { AgentEvent, AgentKind, Item, PastSession, RequestResponse } from '../../shared/agent'

export interface AgentAdapter {
  kind: AgentKind
  /** Returns the agent's id for a session that has not started yet. */
  createSession(cwd: string): Promise<string>
  listSessions(cwd: string): Promise<PastSession[]>
  /** Empty if the session has no transcript yet. */
  loadHistory(agentSessionId: string, cwd: string): Promise<Item[]>
  start(options: StartOptions, emit: (event: AgentEvent) => void): AgentRun
}

/** The run continues the session's transcript if the agent has one. */
export type StartOptions = {
  cwd: string
  agentSessionId: string
}

/**
 * A running agent process. A run that fails or exits emits `errored` and then
 * nothing more; a closed run emits nothing.
 */
export interface AgentRun {
  /** During a turn the message is queued for the agent to pick up. */
  send(text: string): void
  interrupt(): Promise<void>
  respond(requestId: string, response: RequestResponse): void
  close(): void
}
