/**
 * The IDE's agent-neutral session model. Adapters translate each agent's
 * stream into `AgentEvent`s; main and renderer fold them with `applyEvent`.
 * See docs/agent-abstraction.md.
 */

export type AgentKind = 'claude'

export type SessionPointer = { agent: AgentKind; agentSessionId: string }

export type Item =
  | { kind: 'userMessage'; id: string; text: string }
  | { kind: 'agentMessage'; id: string; parentId?: string; text: string }
  | { kind: 'reasoning'; id: string; parentId?: string; text: string }
  | {
      kind: 'toolCall'
      id: string
      parentId?: string
      status: ToolStatus
      title: string
      view: ToolView
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }
  | { kind: 'unknown'; id: string; label: string; raw: unknown }

export type ToolStatus = 'running' | 'completed' | 'failed'

export type ToolView =
  | { type: 'command'; command: string; output: string }
  | { type: 'fileChange'; changes: { path: string; diff: string }[]; output?: string }
  | { type: 'generic'; name: string; input: unknown; output?: string }

export type PendingRequest =
  | {
      kind: 'permission'
      id: string
      itemId?: string
      title: string
      view: ToolView
      options: PermissionOption[]
    }
  | { kind: 'question'; id: string; questions: Question[] }

export type PermissionOption = {
  id: string
  label: string
  kind: 'allowOnce' | 'allowAlways' | 'deny'
}

export type Question = {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

/** Answer text keyed by question; several selected options are joined with ", ". */
export type QuestionAnswers = Record<string, string>

export type RequestResponse =
  | { kind: 'permission'; optionId: string }
  /** `null` dismisses the question without answering. */
  | { kind: 'question'; answers: QuestionAnswers | null }

/** Waiting for input is not a status: it is derived from pending requests. */
export type SessionStatus = 'idle' | 'working' | 'errored'

export type AgentEvent =
  /** Inserts the item, or replaces the one with the same id. */
  | { type: 'itemUpserted'; item: Item }
  /** Streams text into an agent message, reasoning or command output. */
  | { type: 'textAppended'; itemId: string; text: string }
  | { type: 'requestAdded'; request: PendingRequest }
  | { type: 'requestResolved'; requestId: string }
  | { type: 'statusChanged'; status: SessionStatus; error?: string }

export type SessionView = {
  status: SessionStatus
  error?: string
  items: Item[]
  requests: PendingRequest[]
}

export const emptySessionView: SessionView = { status: 'idle', items: [], requests: [] }

export function applyEvent(view: SessionView, event: AgentEvent): SessionView {
  switch (event.type) {
    case 'itemUpserted': {
      const index = findItemIndex(view.items, event.item.id)
      const items = view.items.slice()
      if (index === -1) items.push(event.item)
      else items[index] = event.item
      return { ...view, items }
    }
    case 'textAppended': {
      const index = findItemIndex(view.items, event.itemId)
      if (index === -1) return view
      const items = view.items.slice()
      items[index] = appendText(items[index]!, event.text)
      return { ...view, items }
    }
    case 'requestAdded':
      return { ...view, requests: [...view.requests, event.request] }
    case 'requestResolved':
      return { ...view, requests: view.requests.filter((r) => r.id !== event.requestId) }
    case 'statusChanged':
      return { ...view, status: event.status, error: event.error }
  }
}

// Updates almost always touch the newest items, so search from the end.
function findItemIndex(items: Item[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.id === id) return i
  return -1
}

function appendText(item: Item, text: string): Item {
  switch (item.kind) {
    case 'agentMessage':
    case 'reasoning':
      return { ...item, text: item.text + text }
    case 'toolCall':
      return item.view.type === 'command'
        ? { ...item, view: { ...item.view, output: item.view.output + text } }
        : item
    default:
      return item
  }
}

/** What the tab strip and project switcher show for a session. */
export type SessionSummary = SessionPointer & {
  projectId: string
  title: string
  status: SessionStatus
  attention: Attention
}

export type Attention = 'waiting' | 'unread' | null

export type PastSession = SessionPointer & { title: string; lastActiveAt: number }

export type OpenedSession = {
  view: SessionView
  /** Events with this sequence number or lower are already in `view`. */
  seq: number
  title: string
  draft: string
}

export type SessionEvent = { agentSessionId: string; seq: number; event: AgentEvent }
