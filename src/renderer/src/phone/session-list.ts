import type { PastSession, SessionPointer, SessionSummary } from '../../../shared/agent'

export const maxPastSessions = 20

/** A session on the phone's screen. The title is for sessions main knows no title for yet. */
export type OpenedSession = { pointer: SessionPointer; title: string }

/** The project's loaded sessions, then its recent past sessions that aren't among them. */
export function listSessions(
  projectId: string,
  summaries: SessionSummary[],
  pastSessions: PastSession[],
): { loaded: SessionSummary[]; past: PastSession[] } {
  const pastTitles = new Map(pastSessions.map((session) => [session.agentSessionId, session.title]))
  // A session resumed from its history has no title of its own until it's given one.
  const loaded = summaries
    .filter((summary) => summary.projectId === projectId)
    .map((summary) => ({ ...summary, title: summary.title || (pastTitles.get(summary.agentSessionId) ?? '') }))
  const loadedIds = new Set(loaded.map((summary) => summary.agentSessionId))
  return {
    loaded,
    past: pastSessions.filter((session) => !loadedIds.has(session.agentSessionId)).slice(0, maxPastSessions),
  }
}

const openSessionsKey = 'escritoire.phoneOpenSessions'

function openSessions(): Record<string, OpenedSession> {
  try {
    return JSON.parse(sessionStorage.getItem(openSessionsKey) ?? '{}') as Record<string, OpenedSession>
  } catch {
    return {}
  }
}

/** The session the phone was showing in this project, which reconnecting or reloading returns to. */
export function openSessionIn(projectId: string): OpenedSession | null {
  return openSessions()[projectId] ?? null
}

export function rememberOpenSession(projectId: string, opened: OpenedSession | null): void {
  const { [projectId]: _, ...others } = openSessions()
  try {
    sessionStorage.setItem(openSessionsKey, JSON.stringify(opened ? { ...others, [projectId]: opened } : others))
  } catch { /* It only misses returning to this session. */ }
}
