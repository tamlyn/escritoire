import type { SessionSummary } from '../shared/agent'
import { attentionMessage, newlyNeedingAttention } from '../shared/attention'
import type { PushPayload, PushSubscription } from '../shared/remote'

export type PushTarget = { deviceId: string; subscription: PushSubscription }

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
 * user is away from the desktop, unless the phone is already showing the session.
 */
export class PushAttention {
  private summaries: SessionSummary[] = []

  constructor(private readonly deps: PushAttentionDeps) {}

  update(summaries: SessionSummary[]): void {
    const news = newlyNeedingAttention(this.summaries, summaries)
    this.summaries = summaries
    if (news.length === 0 || this.deps.desktopPresent()) return
    for (const session of news) {
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
      session: {
        projectId: session.projectId,
        pointer: { agent: session.agent, agentSessionId: session.agentSessionId },
        title: session.title,
      },
    }
  }
}
