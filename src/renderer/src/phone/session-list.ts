import type { PastSession, SessionPointer, SessionSummary } from '../../../shared/agent'

export const maxPastSessions = 20

/** The project's loaded sessions, then its recent past sessions that aren't among them. */
export function listSessions(
  projectId: string,
  summaries: SessionSummary[],
  pastSessions: PastSession[],
): { loaded: SessionSummary[]; past: PastSession[] } {
  const loaded = summaries.filter((summary) => summary.projectId === projectId)
  const loadedIds = new Set(loaded.map((summary) => summary.agentSessionId))
  return {
    loaded,
    past: pastSessions.filter((session) => !loadedIds.has(session.agentSessionId)).slice(0, maxPastSessions),
  }
}

const openSessionsKey = 'escritoire.phoneOpenSessions'

function openSessions(): Record<string, SessionPointer> {
  try {
    return JSON.parse(sessionStorage.getItem(openSessionsKey) ?? '{}') as Record<string, SessionPointer>
  } catch {
    return {}
  }
}

/** The session the phone was showing in this project, which reconnecting or reloading returns to. */
export function openSessionIn(projectId: string): SessionPointer | null {
  return openSessions()[projectId] ?? null
}

export function rememberOpenSession(projectId: string, pointer: SessionPointer | null): void {
  const { [projectId]: _, ...others } = openSessions()
  try {
    sessionStorage.setItem(openSessionsKey, JSON.stringify(pointer ? { ...others, [projectId]: pointer } : others))
  } catch { /* It only misses returning to this session. */ }
}
