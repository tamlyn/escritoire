import { join } from 'node:path'
import type { AgentKind } from '../shared/agent'
import { deleteJson, readJson, writeJson } from './json-file'

/** What the IDE remembers about a session that the agent can't tell it. */
export type SessionRecord = {
  agent: AgentKind
  /** Empty until the first message gives the session a title. */
  title: string
  draft: string
  lastSeenAt: number
  lastTurnEndedAt: number
}

type ProjectSessions = Record<string, SessionRecord>

/** One file per project, keyed by the agent's session id. */
export class SessionStore {
  private readonly projects = new Map<string, Promise<ProjectSessions>>()

  constructor(private readonly dataDir: string) {}

  async get(projectId: string, agentSessionId: string): Promise<SessionRecord | undefined> {
    return (await this.load(projectId))[agentSessionId]
  }

  async put(projectId: string, agentSessionId: string, record: SessionRecord): Promise<void> {
    const sessions = await this.load(projectId)
    sessions[agentSessionId] = record
    await writeJson(this.path(projectId), sessions)
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId)
    await deleteJson(this.path(projectId))
  }

  private load(projectId: string): Promise<ProjectSessions> {
    let sessions = this.projects.get(projectId)
    if (!sessions) {
      sessions = readJson(this.path(projectId)).then((saved) => (saved as ProjectSessions) ?? {})
      this.projects.set(projectId, sessions)
    }
    return sessions
  }

  private path(projectId: string): string {
    return join(this.dataDir, 'sessions', `${projectId}.json`)
  }
}
