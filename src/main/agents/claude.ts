import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import {
  type CanUseTool,
  type EffortLevel,
  getSessionMessages,
  type HookCallbackMatcher,
  type McpServerConfig,
  listSessions,
  type PermissionResult,
  type PermissionMode,
  type PermissionUpdate,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  type AgentEvent,
  applyEvent,
  type BackgroundTask,
  type ContextUsage,
  emptySessionView,
  type ImageAttachment,
  type Item,
  type PendingRequest,
  type Question,
  type RequestResponse,
  type SessionSettings,
  type SettingChoices,
  type ToolView,
  type UserInput,
} from '../../shared/agent'
import { readOnlyTools } from '../ide-tools'
import { AsyncQueue } from './async-queue'
import type { AgentAdapter, AgentRun, StartOptions } from './types'

const ideServerName = 'escritoire'

// Lets a machine pin a known-good Claude Code binary instead of the one the SDK bundles.
const claudeCodePath = () => process.env.ESCRITOIRE_CLAUDE_CODE_PATH || undefined

// Behave like ordinary Claude Code: its system prompt, CLAUDE.md and the user's settings.
const settingSources: ('user' | 'project' | 'local')[] = ['user', 'project', 'local']

const permissionModes: SettingChoices['permissionModes'] = [
  { id: 'default', label: 'Ask first' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'auto', label: 'Auto' },
]

/**
 * Gives Claude the IDE's tools, and refuses background Bash commands in favour
 * of the supervisor, so the user can see everything an agent leaves running.
 */
function ideOptions(ide: NonNullable<StartOptions['ide']>): {
  mcpServers: Record<string, McpServerConfig>
  hooks: { PreToolUse: HookCallbackMatcher[] }
} {
  const tool = (name: string) => `mcp__${ideServerName}__${name}`
  return {
    mcpServers: {
      [ideServerName]: {
        type: 'http',
        ...ide,
        tools: readOnlyTools.map((name) => ({ name, permission_policy: 'always_allow' })),
        // Loaded up front rather than behind tool search, so Claude knows the supervisor exists.
        alwaysLoad: true,
      },
    },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            async (input) => {
              const toolInput = 'tool_input' in input ? (input.tool_input as { run_in_background?: unknown }) : {}
              if (toolInput.run_in_background !== true) return {}
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason:
                    `Background commands aren't available here. Start long-running processes with ${tool('start_process')} ` +
                    `(check ${tool('list_processes')} first) so the user can see them, and read their output with ${tool('read_output')}.`,
                },
              }
            },
          ],
        },
      ],
    },
  }
}

export const claudeAdapter: AgentAdapter = {
  kind: 'claude',

  createSession: async () => randomUUID(),

  async listSessions(cwd) {
    const sessions = await listSessions({ dir: cwd })
    return sessions.map((s) => ({
      agent: 'claude',
      agentSessionId: s.sessionId,
      title: s.customTitle ?? s.summary,
      lastActiveAt: s.lastModified,
    }))
  },

  async loadHistory(agentSessionId, cwd) {
    const messages = await getSessionMessages(agentSessionId, { dir: cwd })
    const transcript = new ClaudeTranscript(cwd)
    const events = messages.flatMap((m) => transcript.map(m as unknown as Message))
    const { items, usage } = events.reduce(applyEvent, emptySessionView)
    return { items, usage }
  },

  settingChoices(cwd) {
    choices ??= loadSettingChoices(cwd).catch((error: unknown) => {
      choices = undefined
      throw error
    })
    return choices
  },

  start: (options, emit) => new ClaudeRun(options, emit),
}

// The models are the account's and the user's settings', not the project's, so one list does.
let choices: Promise<SettingChoices> | undefined

/** Asks a Claude Code process that never gets a message, which takes a fraction of a second. */
async function loadSettingChoices(cwd: string): Promise<SettingChoices> {
  const input = new AsyncQueue<SDKUserMessage>()
  const probe = query({
    prompt: input,
    options: { cwd, settingSources, pathToClaudeCodeExecutable: claudeCodePath() },
  })
  try {
    const models = await probe.supportedModels()
    return {
      models: models.map((m) => ({
        id: m.value,
        label: m.displayName,
        description: m.description,
        resolvedId: m.resolvedModel,
        efforts: m.supportedEffortLevels ?? [],
      })),
      permissionModes,
    }
  } finally {
    input.end()
    probe.close()
  }
}

type Pending = {
  toolInput: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  resolve: (result: PermissionResult) => void
}

/**
 * One Claude Code process for a session. It ends for good when closed, when it
 * fails or when Claude Code exits; the session starts a new run to continue.
 */
class ClaudeRun implements AgentRun {
  private readonly input = new AsyncQueue<SDKUserMessage>()
  private query: Query | undefined
  /** Settles once the query exists, or with nothing if the run ended first. */
  private readonly started: Promise<Query | undefined>
  private markStarted!: (query: Query | undefined) => void
  private readonly transcript: ClaudeTranscript
  private readonly pending = new Map<string, Pending>()
  private interrupted = false
  private errorShown = false
  private working = false
  private ended = false

  constructor(
    private readonly options: StartOptions,
    private readonly output: (event: AgentEvent) => void,
  ) {
    this.transcript = new ClaudeTranscript(options.cwd)
    this.started = new Promise((resolve) => (this.markStarted = resolve))
    void this.run()
  }

  send({ text, images }: UserInput): void {
    this.emit({
      type: 'itemUpserted',
      item: { kind: 'userMessage', id: randomUUID(), text, ...(images.length ? { images } : {}) },
    })
    this.setWorking(true)
    this.input.push({
      type: 'user',
      message: {
        role: 'user',
        content: images.length
          ? [
              ...images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: image.mediaType as ImageMediaType, data: image.data },
              })),
              ...(text ? [{ type: 'text' as const, text }] : []),
            ]
          : text,
      },
      parent_tool_use_id: null,
    })
  }

  async changeSettings(settings: SessionSettings): Promise<void> {
    const query = await this.started
    if (!query) return
    if ('model' in settings) await query.setModel(settings.model)
    if ('effort' in settings) await query.applyFlagSettings({ effortLevel: (settings.effort as EffortLevel) ?? null })
    if (settings.permissionMode) await query.setPermissionMode(settings.permissionMode as PermissionMode)
  }

  async stopTask(taskId: string): Promise<void> {
    await (await this.started)?.stopTask(taskId)
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    await this.query?.interrupt()
  }

  respond(requestId: string, response: RequestResponse): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.settle(requestId, pending, toPermissionResult(pending, response))
  }

  close(): void {
    // Closed by the session, which no longer wants its events.
    this.end()
  }

  private async run(): Promise<void> {
    try {
      // Resume only once Claude Code has a transcript: a first run can fail
      // before writing one, and resuming an id it has never seen fails forever.
      const history = await getSessionMessages(this.options.agentSessionId, { dir: this.options.cwd }).catch(() => [])
      if (this.ended) return
      const { model, effort, permissionMode } = this.options.settings
      this.query = query({
        prompt: this.input,
        options: {
          cwd: this.options.cwd,
          ...(history.length > 0
            ? { resume: this.options.agentSessionId }
            : { sessionId: this.options.agentSessionId }),
          includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          settingSources,
          model,
          effort: effort as EffortLevel | undefined,
          permissionMode: permissionMode as PermissionMode | undefined,
          // Without summaries, recent models return thinking blocks with no text.
          thinking: { type: 'adaptive', display: 'summarized' },
          canUseTool: this.canUseTool,
          pathToClaudeCodeExecutable: claudeCodePath(),
          ...(this.options.ide ? ideOptions(this.options.ide) : {}),
        },
      })
      this.markStarted(this.query)
      for await (const message of this.query) {
        // A message queued during a turn becomes a turn of its own after the result.
        if (activityTypes.has(message.type)) this.setWorking(true)
        if (isApiError(message as Message)) this.errorShown = true
        for (const event of this.transcript.map(message)) this.emit(event)
        if (message.type === 'result') this.endTurn(message)
      }
      this.fail('Claude Code exited.')
    } catch (error) {
      this.fail(errorMessage(error))
    }
  }

  private fail(error: string): void {
    if (this.ended) return
    for (const [id, pending] of this.pending) {
      this.settle(id, pending, { behavior: 'deny', message: 'Claude Code stopped.' })
    }
    // Background tasks die with Claude Code.
    this.emit({ type: 'tasksChanged', tasks: [] })
    this.emit({ type: 'statusChanged', status: 'errored', error })
    this.end()
  }

  private end(): void {
    if (this.ended) return
    this.ended = true
    this.markStarted(this.query)
    for (const [id, pending] of this.pending) {
      this.settle(id, pending, { behavior: 'deny', message: 'The session was closed.' })
    }
    this.input.end()
    this.query?.close()
  }

  private emit(event: AgentEvent): void {
    if (!this.ended) this.output(event)
  }

  private setWorking(working: boolean): void {
    if (this.working === working) return
    this.working = working
    this.emit({ type: 'statusChanged', status: working ? 'working' : 'idle' })
  }

  private endTurn(result: Extract<SDKMessage, { type: 'result' }>): void {
    // An interrupted turn ends with an error result, but the transcript already shows the interruption.
    // A failed request's result repeats the error the transcript already shows.
    if (!this.interrupted && !this.errorShown) {
      if (result.subtype !== 'success') {
        this.emit(notice('error', result.errors.join('\n') || result.subtype))
      } else if (result.is_error) {
        this.emit(notice('error', result.result))
      }
    }
    this.interrupted = false
    this.errorShown = false
    this.setWorking(false)
  }

  private canUseTool: CanUseTool = (toolName, toolInput, { signal, suggestions, toolUseID, title }) =>
    new Promise((resolve) => {
      const id = randomUUID()
      const request: PendingRequest =
        toolName === 'AskUserQuestion'
          ? { kind: 'question', id, questions: toolInput.questions as Question[] }
          : {
              kind: 'permission',
              id,
              itemId: toolUseID,
              title: title ?? `Allow ${toolName}?`,
              view: toolView(toolName, toolInput, this.options.cwd),
              options: [
                { id: 'allow', label: 'Allow', kind: 'allowOnce' },
                ...(suggestions?.length
                  ? [{ id: 'always', label: 'Always allow', kind: 'allowAlways' as const }]
                  : []),
                { id: 'deny', label: 'Deny', kind: 'deny' },
              ],
            }
      const pending = { toolInput, suggestions, resolve }
      this.pending.set(id, pending)
      this.emit({ type: 'requestAdded', request })
      signal.addEventListener(
        'abort',
        () => this.settle(id, pending, { behavior: 'deny', message: 'Cancelled.' }),
        { once: true },
      )
    })

  private settle(id: string, pending: Pending, result: PermissionResult): void {
    if (!this.pending.delete(id)) return
    this.emit({ type: 'requestResolved', requestId: id })
    pending.resolve(result)
  }
}

const activityTypes = new Set(['assistant', 'user', 'stream_event'])

function toPermissionResult(pending: Pending, response: RequestResponse): PermissionResult {
  if (response.kind === 'question') {
    return response.answers
      ? { behavior: 'allow', updatedInput: { ...pending.toolInput, answers: response.answers } }
      : { behavior: 'deny', message: 'The user dismissed the question without answering.' }
  }
  switch (response.optionId) {
    case 'allow':
      return { behavior: 'allow', updatedInput: pending.toolInput }
    case 'always':
      return {
        behavior: 'allow',
        updatedInput: pending.toolInput,
        updatedPermissions: pending.suggestions,
      }
    default:
      return { behavior: 'deny', message: 'The user denied this.' }
  }
}

// The live stream and saved history share the Messages API shapes, typed
// loosely here because history messages are untyped and new block types appear.
type Message = { type: string; [key: string]: unknown }
type Block = { type: string; [key: string]: unknown }
type ApiMessage = { id?: string; model?: string; content: string | Block[]; usage?: ApiUsage }
type ApiUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null
}
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const minute = 60_000

/**
 * Turns Claude messages, live or from history, into item events.
 *
 * The SDK delivers each content block of an API message as its own message,
 * in order, so a block's item id is the API message id plus its position.
 * Streamed deltas carry the same position as their block index.
 */
export class ClaudeTranscript {
  private readonly blockCounts = new Map<string, number>()
  private readonly toolCalls = new Map<string, ToolCall>()
  private streamMessageId: string | undefined
  private usage: ContextUsage | undefined
  private readonly contextWindows = new Map<string, number>()
  private usageModel: string | undefined
  // Claude Code also reports foreground tasks finishing; only background ones need a notice.
  private readonly backgroundTaskIds = new Set<string>()
  private tasks: { id: string; type: string; description: string }[] = []
  /** The tool that started each task, which names it better than its type: a monitor is a shell task. */
  private readonly taskTools = new Map<string, string>()

  constructor(private readonly cwd: string) {}

  map(message: Message | SDKMessage): AgentEvent[] {
    const parentId = (message as Message).parent_tool_use_id as string | null | undefined
    switch (message.type) {
      case 'stream_event':
        return this.mapStreamEvent((message as Message).event as Block, parentId ?? undefined)
      case 'assistant': {
        const apiMessage = (message as Message).message as ApiMessage
        // Claude Code reports a failed request as a reply of its own, with no usage worth showing.
        if (apiMessage.model === syntheticModel) {
          return isApiError(message as Message)
            ? [upsert({ kind: 'notice', id: (message as Message).uuid as string, level: 'error', text: textOf(apiMessage) })]
            : this.mapAssistant(apiMessage, parentId ?? undefined)
        }
        return [
          ...this.mapAssistant(apiMessage, parentId ?? undefined),
          ...(parentId ? [] : this.mapUsage(apiMessage, (message as Message).timestamp)),
        ]
      }
      case 'user':
        return this.mapUser(message as Message, parentId ?? undefined)
      case 'system':
        return this.mapSystem(message as Message)
      case 'result':
        return this.mapResult(message as Message)
      default:
        return []
    }
  }

  private mapSystem(message: Message): AgentEvent[] {
    switch (message.subtype) {
      case 'compact_boundary':
        return [notice('info', 'Conversation compacted')]
      case 'init':
        return [
          {
            type: 'settingsChanged',
            settings: { model: message.model as string, permissionMode: message.permissionMode as string },
          },
        ]
      case 'status':
        return message.permissionMode
          ? [{ type: 'settingsChanged', settings: { permissionMode: message.permissionMode as string } }]
          : []
      case 'background_tasks_changed': {
        this.tasks = (message.tasks as { task_id: string; task_type: string; description: string; ambient?: boolean }[])
          .filter((task) => !task.ambient)
          .map((task) => ({ id: task.task_id, type: task.task_type, description: task.description }))
        for (const task of this.tasks) this.backgroundTaskIds.add(task.id)
        return [this.tasksChanged()]
      }
      case 'task_started': {
        const call = this.toolCalls.get(message.tool_use_id as string)
        if (!call) return []
        this.taskTools.set(message.task_id as string, call.view.type === 'generic' ? call.view.name : 'Bash')
        // The task usually joins the background set before it is reported started.
        return this.tasks.some((task) => task.id === message.task_id) ? [this.tasksChanged()] : []
      }
      case 'task_notification':
        return this.backgroundTaskIds.has(message.task_id as string) && !message.skip_transcript
          ? [upsert({ kind: 'notice', id: message.uuid as string, level: 'info', text: message.summary as string })]
          : []
      default:
        return []
    }
  }

  private tasksChanged(): AgentEvent {
    const tasks = this.tasks.map(
      (task): BackgroundTask => ({
        id: task.id,
        kind: this.taskTools.get(task.id) ?? taskKind(task.type),
        description: task.description,
      }),
    )
    return { type: 'tasksChanged', tasks }
  }

  private mapUsage(message: ApiMessage, timestamp: unknown): AgentEvent[] {
    const usage = message.usage
    if (!usage || !message.model) return []
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
    const writes = usage.cache_creation
    // A request that only reads the cache doesn't say how long it lives, but
    // a read keeps the lifetime it was written with.
    const cacheTtlMs = writes?.ephemeral_1h_input_tokens
      ? 60 * minute
      : writes?.ephemeral_5m_input_tokens
        ? 5 * minute
        : this.usage?.cacheTtlMs
    this.usageModel = message.model
    this.usage = {
      contextTokens: (usage.input_tokens ?? 0) + cacheReadTokens + cacheWriteTokens + (usage.output_tokens ?? 0),
      contextWindow: this.contextWindows.get(message.model),
      cacheReadTokens,
      cacheWriteTokens,
      cacheTtlMs,
      at: typeof timestamp === 'string' ? Date.parse(timestamp) : Date.now(),
    }
    return [{ type: 'usageChanged', usage: this.usage }]
  }

  /** Only results give the context window's size, so the usage before them lacks it. */
  private mapResult(result: Message): AgentEvent[] {
    const models = (result.modelUsage ?? {}) as Record<string, { contextWindow?: number }>
    for (const [model, usage] of Object.entries(models)) {
      if (usage.contextWindow) this.contextWindows.set(model, usage.contextWindow)
    }
    const contextWindow = this.usageModel && this.contextWindows.get(this.usageModel)
    if (!this.usage || !contextWindow || this.usage.contextWindow === contextWindow) return []
    this.usage = { ...this.usage, contextWindow }
    return [{ type: 'usageChanged', usage: this.usage }]
  }

  private mapStreamEvent(event: Block, parentId: string | undefined): AgentEvent[] {
    switch (event.type) {
      case 'message_start':
        this.streamMessageId = (event.message as ApiMessage).id
        return []
      case 'content_block_start': {
        const block = event.content_block as Block
        const id = `${this.streamMessageId}#${event.index}`
        if (block.type === 'text') {
          return [upsert({ kind: 'agentMessage', id, parentId, text: '' })]
        }
        if (block.type === 'thinking') {
          return [upsert({ kind: 'reasoning', id, parentId, text: '' })]
        }
        return []
      }
      case 'content_block_delta': {
        const delta = event.delta as Block
        const itemId = `${this.streamMessageId}#${event.index}`
        if (delta.type === 'text_delta') return [append(itemId, delta.text as string)]
        if (delta.type === 'thinking_delta') return [append(itemId, delta.thinking as string)]
        return []
      }
      default:
        return []
    }
  }

  private mapAssistant(message: ApiMessage, parentId: string | undefined): AgentEvent[] {
    if (!message.id || typeof message.content === 'string') return []
    const messageId = message.id
    return message.content.flatMap((block) => {
      const position = this.blockCounts.get(messageId) ?? 0
      this.blockCounts.set(messageId, position + 1)
      const id = `${messageId}#${position}`
      switch (block.type) {
        case 'text':
          return [upsert({ kind: 'agentMessage', id, parentId, text: block.text as string })]
        case 'thinking':
          return [upsert({ kind: 'reasoning', id, parentId, text: block.thinking as string })]
        case 'redacted_thinking':
          return []
        case 'tool_use': {
          const name = block.name as string
          const input = block.input as Record<string, unknown>
          const item: ToolCall = {
            kind: 'toolCall',
            id: block.id as string,
            parentId,
            status: 'running',
            title: toolTitle(name, input, this.cwd),
            view: toolView(name, input, this.cwd),
          }
          this.toolCalls.set(item.id, item)
          return [upsert(item)]
        }
        default:
          return [upsert({ kind: 'unknown', id, label: block.type, raw: block })]
      }
    })
  }

  private mapUser(message: Message, parentId: string | undefined): AgentEvent[] {
    const content = (message.message as ApiMessage).content
    const id = message.uuid as string
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content
    const text = textOf({ content })
    const images = blocks.flatMap((b) => (b.type === 'image' ? imageAttachment(b) : []))
    // Claude Code's own prompts to the model, such as skill bodies and image captions.
    const synthetic = Boolean(message.isMeta || message.isSynthetic)
    const events: AgentEvent[] = []
    if ((text || images.length) && !parentId && !synthetic) {
      events.push(upsert(userItem(id, text, images)))
    }
    if (typeof content === 'string') return events
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      const call = this.toolCalls.get(block.tool_use_id as string)
      if (!call) continue
      const item = withResult(call, Boolean(block.is_error), resultText(block.content))
      this.toolCalls.set(item.id, item)
      events.push(upsert(item))
    }
    return events
  }
}

const interruptionMarker = /^\[Request interrupted by user[^\]]*\]$/

const syntheticModel = '<synthetic>'

/** A request that failed, which Claude Code reports as a synthetic reply, live and in history. */
function isApiError(message: Message): boolean {
  return message.type === 'assistant' && Boolean(message.error) && (message.message as ApiMessage).model === syntheticModel
}

function textOf({ content }: Pick<ApiMessage, 'content'>): string {
  if (typeof content === 'string') return content
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text as string)
    .join('\n')
}

/**
 * Claude Code records interruptions and background task notifications as user
 * messages. Live, the notification arrives as a system message instead.
 */
function userItem(id: string, text: string, images: ImageAttachment[]): Item {
  if (interruptionMarker.test(text)) return { kind: 'notice', id, level: 'info', text: 'Interrupted' }
  const notification = /^<task-notification>[\s\S]*<summary>([\s\S]*?)<\/summary>(?:\s*<event>([\s\S]*?)<\/event>)?/.exec(text)
  if (notification) {
    return { kind: 'notice', id, level: 'info', text: [notification[1], notification[2]].filter(Boolean).join(': ') }
  }
  return { kind: 'userMessage', id, text, ...(images.length ? { images } : {}) }
}

function imageAttachment(block: Block): ImageAttachment[] {
  const source = block.source as { type?: string; media_type?: string; data?: string } | undefined
  return source?.type === 'base64' && source.media_type && source.data
    ? [{ mediaType: source.media_type, data: source.data }]
    : []
}

const taskKinds: Record<string, string> = {
  local_bash: 'Shell',
  local_agent: 'Agent',
  local_workflow: 'Workflow',
  mcp_task: 'Tool',
}

function taskKind(taskType: string): string {
  return taskKinds[taskType] ?? taskType
}

type ToolCall = Extract<Item, { kind: 'toolCall' }>

function withResult(call: ToolCall, isError: boolean, output: string): ToolCall {
  const status = isError ? 'failed' : 'completed'
  switch (call.view.type) {
    case 'command':
    case 'generic':
      return { ...call, status, view: { ...call.view, output } }
    case 'fileChange':
      // A successful edit's result only restates the change.
      return { ...call, status, view: isError ? { ...call.view, output } : call.view }
  }
}

function upsert(item: Item): AgentEvent {
  return { type: 'itemUpserted', item }
}

function append(itemId: string, text: string): AgentEvent {
  return { type: 'textAppended', itemId, text }
}

function notice(level: 'info' | 'error', text: string): AgentEvent {
  return upsert({ kind: 'notice', id: randomUUID(), level, text })
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[])
    .map((b) => (b.type === 'text' ? (b.text as string) : `[${b.type}]`))
    .join('\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toolView(name: string, input: Record<string, unknown>, cwd: string): ToolView {
  switch (name) {
    case 'Bash':
      return { type: 'command', command: String(input.command ?? ''), output: '' }
    case 'Edit':
      return {
        type: 'fileChange',
        changes: [
          {
            path: displayPath(input.file_path, cwd),
            diff: prefixLines(input.old_string, '-') + prefixLines(input.new_string, '+'),
          },
        ],
      }
    case 'Write':
      return {
        type: 'fileChange',
        changes: [{ path: displayPath(input.file_path, cwd), diff: prefixLines(input.content, '+') }],
      }
    default:
      return { type: 'generic', name, input }
  }
}

function toolTitle(name: string, input: Record<string, unknown>, cwd: string): string {
  const detail =
    name === 'Bash'
      ? (input.description ?? input.command)
      : input.file_path !== undefined
        ? displayPath(input.file_path, cwd)
        : (input.description ?? input.pattern ?? input.url ?? input.query)
  return typeof detail === 'string' && detail ? `${name}: ${detail}` : name
}

function displayPath(path: unknown, cwd: string): string {
  const absolute = String(path ?? '')
  const relativePath = relative(cwd, absolute)
  return relativePath.startsWith('..') ? absolute : relativePath
}

// Edits carry the old and new text rather than a diff; showing them as removed
// and added lines is enough to read the change.
function prefixLines(text: unknown, prefix: string): string {
  if (typeof text !== 'string' || text === '') return ''
  return text.replace(/\n$/, '').split('\n').map((line) => `${prefix}${line}\n`).join('')
}
