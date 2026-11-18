import type { SessionSummary } from './agent'

/** The sessions that need the user: waiting for input first, then unread. */
export function needingAttention(summaries: SessionSummary[]): SessionSummary[] {
  return [
    ...summaries.filter((s) => s.attention === 'waiting'),
    ...summaries.filter((s) => s.attention === 'unread'),
  ]
}

/** What to tell the user about a session that needs them. */
export function attentionMessage(session: SessionSummary): string {
  const title = session.title || 'New session'
  return session.attention === 'waiting' ? `${title} needs your input` : `${title} has finished`
}

/**
 * The sessions that started needing the user between two lists: ones that
 * began waiting, or became unread having needed nothing. A session missing
 * from `before` has just loaded, so whatever it needs isn't news.
 */
export function newlyNeedingAttention(before: SessionSummary[], after: SessionSummary[]): SessionSummary[] {
  const previous = new Map(before.map((s) => [s.agentSessionId, s.attention]))
  return after.filter((s) => {
    if (!previous.has(s.agentSessionId)) return false
    const was = previous.get(s.agentSessionId)
    return (s.attention === 'waiting' && was !== 'waiting') || (s.attention === 'unread' && was === null)
  })
}
