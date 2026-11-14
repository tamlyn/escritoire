/**
 * The IDE's agent-neutral session model. Adapters translate each agent's
 * stream into `AgentEvent`s; main and renderer fold them with `applyEvent`.
 * See docs/agent-abstraction.md.
 */

export type AgentKind = 'claude' | 'codex'

export type SessionPointer = { agent: AgentKind; agentSessionId: string }

/** Base64 image data, as the agents take it. */
export type ImageAttachment = { mediaType: string; data: string }

export type UserInput = { text: string; images: ImageAttachment[] }

export type Item =
  | { kind: 'userMessage'; id: string; text: string; images?: ImageAttachment[] }
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

/** What the session runs with. An unset value is the agent's own default. */
export type SessionSettings = { model?: string; effort?: string; permissionMode?: string }

/** The values the agent accepts for each setting. */
export type SettingChoices = {
  models: ModelChoice[]
  permissionModes: { id: string; label: string }[]
}

export type ModelChoice = {
  id: string
  label: string
  description?: string
  /** The model an alias such as `default` currently stands for. */
  resolvedId?: string
  efforts: string[]
}

/** From the latest request the agent made in the main conversation. */
export type ContextUsage = {
  /** Everything the request sent plus its reply: how full the context window is. */
  contextTokens: number
  contextWindow?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** How long the prompt cache outlives the request, once a cache write has said. */
  cacheTtlMs?: number
  /** When the request was answered, in epoch milliseconds. */
  at: number
}

/** Work the agent left running in the background, such as a monitor or a background subagent. */
export type BackgroundTask = { id: string; kind: string; description: string }

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
  /** Merged into the current settings. */
  | { type: 'settingsChanged'; settings: SessionSettings }
  | { type: 'usageChanged'; usage: ContextUsage }
  /** The whole set of running background tasks. */
  | { type: 'tasksChanged'; tasks: BackgroundTask[] }

export type SessionView = {
  status: SessionStatus
  error?: string
  items: Item[]
  requests: PendingRequest[]
  settings: SessionSettings
  usage?: ContextUsage
  tasks: BackgroundTask[]
}

export const emptySessionView: SessionView = {
  status: 'idle',
  items: [],
  requests: [],
  settings: {},
  tasks: [],
}

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
    case 'settingsChanged':
      return { ...view, settings: { ...view.settings, ...event.settings } }
    case 'usageChanged':
      return { ...view, usage: event.usage }
    case 'tasksChanged':
      return { ...view, tasks: event.tasks }
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
