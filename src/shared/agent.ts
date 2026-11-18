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

/** A message the user sent during a turn, held by the IDE until the turn ends. */
export type QueuedMessage = UserInput & { id: string }

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

/**
 * What the session runs with. An unset or `null` value is the agent's own
 * default. In a change, a missing setting stays as it is and `null` resets it.
 */
export type SessionSettings = { model?: string | null; effort?: string | null; permissionMode?: string | null }

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

/** A command the composer offers after `/`. Messages starting `/name` run it. */
export type SlashCommand = { name: string; description: string; argumentHint?: string }

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
  /** What fills the context, as of the end of the latest turn, for agents that say. */
  categories?: ContextCategory[]
}

/** Reserved space, such as the compaction buffer, is held back rather than in use. */
export type ContextCategory = { name: string; tokens: number; reserved: boolean }

/** How much of one of the subscription's usage allowances is spent, account-wide. */
export type PlanLimit = {
  label: string
  usedPercent: number
  /** In epoch milliseconds. */
  resetsAt: number | null
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
  | { type: 'limitsChanged'; limits: PlanLimit[] }
  /** The whole set of running background tasks. */
  | { type: 'tasksChanged'; tasks: BackgroundTask[] }
  /**
   * The agent discarded the conversation, as `/clear` does, and the run carries
   * on as a new session with an empty transcript. The old one stays resumable.
   */
  | { type: 'conversationReset'; agentSessionId: string }
  /** The session's whole queue. From the session manager, not an adapter. */
  | { type: 'queueChanged'; queued: QueuedMessage[] }

export type SessionView = {
  status: SessionStatus
  error?: string
  items: Item[]
  requests: PendingRequest[]
  settings: SessionSettings
  usage?: ContextUsage
  limits?: PlanLimit[]
  tasks: BackgroundTask[]
  queued: QueuedMessage[]
}

export const emptySessionView: SessionView = {
  status: 'idle',
  items: [],
  requests: [],
  settings: {},
  tasks: [],
  queued: [],
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
    case 'limitsChanged':
      return { ...view, limits: event.limits }
    case 'tasksChanged':
      return { ...view, tasks: event.tasks }
    case 'conversationReset':
      return { ...emptySessionView, status: view.status, settings: view.settings, limits: view.limits, tasks: view.tasks, queued: view.queued }
    case 'queueChanged':
      return { ...view, queued: event.queued }
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

/** How many past sessions to offer. */
export const maxPastSessions = 20

/** A session to go to, from a notification or the inbox. */
export type SessionTarget = { projectId: string; pointer: SessionPointer; title: string }

export function sessionTarget({ projectId, agent, agentSessionId, title }: SessionSummary): SessionTarget {
  return { projectId, pointer: { agent, agentSessionId }, title }
}

export type OpenedSession = {
  view: SessionView
  /** Events with this sequence number or lower are already in `view`. */
  seq: number
  title: string
  draft: string
  /** The session the conversation continues in, if the agent reset it. Nothing else is filled in then. */
  movedTo: string | null
}

export type SessionEvent = { agentSessionId: string; seq: number; event: AgentEvent }
