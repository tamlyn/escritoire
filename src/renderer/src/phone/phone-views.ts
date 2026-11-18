import { normalizeWorkspaceModel } from 'react-resizable-panels'
import { maxPastSessions, type PastSession, type SessionPointer, type SessionSummary } from '../../../shared/agent'
import { tabsetsIn } from '../layout-tree'
import type { TabData } from '../tabs'

/** A session on the phone's screen. The title is for sessions main knows no title for yet. */
export type SessionPhoneView = { kind: 'session'; pointer: SessionPointer; title: string }

/** What fills the phone's screen, other than the project's list. Going back from a file returns to `from`. */
export type PhoneView =
  | SessionPhoneView
  | { kind: 'file'; path: string; from: SessionPhoneView | null }
  | { kind: 'terminal'; terminalId: string; title: string }

/** The terminals in the desktop's saved layout, which is only read. */
export function terminalsIn(layout: unknown): { id: string; title: string }[] {
  const model = normalizeWorkspaceModel<TabData>(layout)
  if (!model) return []
  return [...tabsetsIn(model)].flatMap((tabset) => tabset.tabs
    .filter((tab) => tab.data?.kind === 'terminal')
    .map((tab) => ({ id: tab.id, title: tab.title ?? 'Terminal' })))
}

/** What Ctrl and a key send: the key's control character if it has one, and other input unchanged. */
export function withCtrl(data: string): string {
  if (data === ' ') return '\0'
  return /^[a-zA-Z@[\\\]^_]$/.test(data) ? String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64) : data
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
const startedTerminalsKey = 'escritoire.phoneStartedTerminals'

function readByProject<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, T>
  } catch {
    return {}
  }
}

function saveForProject<T>(key: string, projectId: string, value: T | null): void {
  const { [projectId]: _, ...others } = readByProject<T>(key)
  try {
    sessionStorage.setItem(key, JSON.stringify(value === null ? others : { ...others, [projectId]: value }))
  } catch { /* It only misses returning to where the phone was. */ }
}

/** The terminals the phone started in this project and hasn't closed, so it can return to them. */
export function startedTerminalsIn(projectId: string): string[] {
  return readByProject<string[]>(startedTerminalsKey)[projectId] ?? []
}

export function rememberStartedTerminal(projectId: string, terminalId: string): void {
  saveForProject(startedTerminalsKey, projectId, [...startedTerminalsIn(projectId), terminalId])
}

export function forgetStartedTerminal(projectId: string, terminalId: string): void {
  saveForProject(startedTerminalsKey, projectId, startedTerminalsIn(projectId).filter((id) => id !== terminalId))
}

/** What the phone was showing in this project, which reconnecting or reloading returns to. */
export function openViewIn(projectId: string): PhoneView | null {
  return readByProject<PhoneView>(openViewsKey)[projectId] ?? null
}

export function rememberOpenView(projectId: string, view: PhoneView | null): void {
  saveForProject(openViewsKey, projectId, view)
}
