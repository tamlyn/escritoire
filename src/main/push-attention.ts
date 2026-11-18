import { sessionTarget, type SessionSummary } from '../shared/agent'
import { attentionMessage, newlyNeedingAttention } from '../shared/attention'
import type { PushPayload, PushTarget } from '../shared/remote'

export type PushAttentionDeps = {
  /** The subscribed devices, none while remote access is off. */
  targets: () => PushTarget[]
  desktopPresent: () => boolean
  deviceShows: (deviceId: string, agentSessionId: string) => boolean
  projectName: (projectId: string) => string
  send: (target: PushTarget, payload: PushPayload) => Promise<void>
}

/**
 * Tells paired phones about sessions that start needing the user while the
 * user is away from the desktop, unless the phone is already showing the
 * session. It takes a minute to count as away, so what comes up while the user
 * is present is held, and sent if they leave without dealing with it.
 */
export class PushAttention {
  private summaries: SessionSummary[] = []
  private readonly held = new Set<string>()

  constructor(private readonly deps: PushAttentionDeps) {}

  update(summaries: SessionSummary[]): void {
    const news = newlyNeedingAttention(this.summaries, summaries)
    this.summaries = summaries
    if (this.deps.desktopPresent()) for (const session of news) this.held.add(session.agentSessionId)
    else this.push(news)
  }

  /** The user has left the desktop. */
  desktopLeft(): void {
    this.push(this.summaries.filter((session) => session.attention !== null && this.held.has(session.agentSessionId)))
    this.held.clear()
  }

  private push(sessions: SessionSummary[]): void {
    for (const session of sessions) {
      for (const target of this.deps.targets()) {
        if (this.deps.deviceShows(target.deviceId, session.agentSessionId)) continue
        this.deps.send(target, this.payload(session)).catch((error: unknown) => console.error("Couldn't send a notification:", error))
      }
    }
  }

  private payload(session: SessionSummary): PushPayload {
    return {
      title: this.deps.projectName(session.projectId),
      body: attentionMessage(session),
      session: sessionTarget(session),
    }
  }
}
