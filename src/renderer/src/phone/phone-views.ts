import { normalizeWorkspaceModel, type WorkspaceNode } from 'react-resizable-panels'
import type { PastSession, SessionPointer, SessionSummary } from '../../../shared/agent'
import type { TabData } from '../tabs'

export const maxPastSessions = 20

/** A session on the phone's screen. The title is for sessions main knows no title for yet. */
export type SessionPhoneView = { kind: 'session'; pointer: SessionPointer; title: string }

/** What fills the phone's screen, other than the project's list. Going back from a file returns to `from`. */
export type PhoneView =
  | SessionPhoneView
  | { kind: 'file'; path: string; from: SessionPhoneView | null }
  | { kind: 'terminal'; terminalId: string; title: string; startedHere: boolean }

/** The terminals in the desktop's saved layout, which is only read. */
export function terminalsIn(layout: unknown): { id: string; title: string }[] {
  const model = normalizeWorkspaceModel<TabData>(layout)
  if (!model) return []
  const terminals: { id: string; title: string }[] = []
  const visit = (node: WorkspaceNode<TabData>) => {
    if (node.type === 'split') node.children.forEach(visit)
    else for (const tab of node.tabs) if (tab.data?.kind === 'terminal') terminals.push({ id: tab.id, title: tab.title ?? 'Terminal' })
  }
  visit(model.root)
  model.floating?.forEach(visit)
  return terminals
}

/** What Ctrl and a key send: the control character for a letter, and other input unchanged. */
export function withCtrl(data: string): string {
  return /^[a-zA-Z]$/.test(data) ? String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64) : data
}

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

const openViewsKey = 'escritoire.phoneOpenViews'

function openViews(): Record<string, PhoneView> {
  try {
    return JSON.parse(sessionStorage.getItem(openViewsKey) ?? '{}') as Record<string, PhoneView>
  } catch {
    return {}
  }
}

/** What the phone was showing in this project, which reconnecting or reloading returns to. */
export function openViewIn(projectId: string): PhoneView | null {
  return openViews()[projectId] ?? null
}

export function rememberOpenView(projectId: string, view: PhoneView | null): void {
  const { [projectId]: _, ...others } = openViews()
  try {
    sessionStorage.setItem(openViewsKey, JSON.stringify(view ? { ...others, [projectId]: view } : others))
  } catch { /* It only misses returning to this view. */ }
}
