import { app, type BrowserWindow, Notification } from 'electron'
import { sessionTarget, type SessionSummary } from '../shared/agent'
import type { Events } from '../shared/api'
import { attentionMessage, needingAttention, newlyNeedingAttention } from '../shared/attention'

export type DesktopAttentionDeps = {
  projectName: (projectId: string) => string
  focusSession: (session: Events['focusSession']) => void
}

/**
 * Tells the user at the desktop about sessions that need them while the window
 * isn't focused: a count on the dock icon, and a notification each time one
 * starts waiting or finishes. A focused window shows them itself.
 */
export class DesktopAttention {
  private summaries: SessionSummary[] = []
  private window: BrowserWindow | null = null
  // Electron drops a notification's handlers if the notification is garbage collected.
  private readonly shown = new Set<Notification>()

  constructor(private readonly deps: DesktopAttentionDeps) {}

  attach(window: BrowserWindow): void {
    this.window = window
    window.on('focus', () => this.updateBadge())
    window.on('blur', () => this.updateBadge())
    window.once('closed', () => {
      this.window = null
    })
  }

  update(summaries: SessionSummary[]): void {
    const news = this.away() ? newlyNeedingAttention(this.summaries, summaries) : []
    this.summaries = summaries
    this.updateBadge()
    for (const session of news) this.notify(session)
  }

  private away(): boolean {
    return this.window !== null && !this.window.isDestroyed() && !this.window.isFocused()
  }

  private updateBadge(): void {
    app.setBadgeCount(this.away() ? needingAttention(this.summaries).length : 0)
  }

  private notify(session: SessionSummary): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: this.deps.projectName(session.projectId),
      body: attentionMessage(session),
    })
    this.shown.add(notification)
    notification.on('close', () => this.shown.delete(notification))
    notification.on('click', () => {
      this.shown.delete(notification)
      const window = this.window
      if (!window || window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      this.deps.focusSession(sessionTarget(session))
    })
    notification.show()
  }
}
