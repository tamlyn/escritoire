import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import {
  type CanUseTool,
  getSessionMessages,
  listSessions,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  type AgentEvent,
  applyEvent,
  emptySessionView,
  type Item,
  type PendingRequest,
  type Question,
  type RequestResponse,
  type ToolView,
} from '../../shared/agent'
import { AsyncQueue } from './async-queue'
import type { AgentAdapter, AgentRun, StartOptions } from './types'

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
    return events.reduce(applyEvent, emptySessionView).items
  },

  start: (options, emit) => new ClaudeRun(options, emit),
}

type Pending = {
  toolInput: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  resolve: (result: PermissionResult) => void
}

class ClaudeRun implements AgentRun {
  private readonly input = new AsyncQueue<SDKUserMessage>()
  private readonly query: Query
  private readonly transcript: ClaudeTranscript
  private readonly pending = new Map<string, Pending>()
  private interrupted = false

  constructor(
    private readonly options: StartOptions,
    private readonly emit: (event: AgentEvent) => void,
  ) {
    this.transcript = new ClaudeTranscript(options.cwd)
    this.query = query({
      prompt: this.input,
      options: {
        cwd: options.cwd,
        ...(options.resume
          ? { resume: options.agentSessionId }
          : { sessionId: options.agentSessionId }),
        includePartialMessages: true,
        // Behave like ordinary Claude Code: its system prompt, CLAUDE.md and the user's settings.
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        canUseTool: this.canUseTool,
      },
    })
    void this.consume()
  }

  send(text: string): void {
    this.emit({ type: 'itemUpserted', item: { kind: 'userMessage', id: randomUUID(), text } })
    this.emit({ type: 'statusChanged', status: 'working' })
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    await this.query.interrupt()
  }

  respond(requestId: string, response: RequestResponse): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.settle(requestId, pending, toPermissionResult(pending, response))
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      this.settle(id, pending, { behavior: 'deny', message: 'The session was closed.' })
    }
    this.input.end()
    this.query.close()
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.query) {
        for (const event of this.transcript.map(message)) this.emit(event)
        if (message.type === 'result') this.endTurn(message)
      }
    } catch (error) {
      this.emit({ type: 'statusChanged', status: 'errored', error: errorMessage(error) })
    }
  }

  private endTurn(result: Extract<SDKMessage, { type: 'result' }>): void {
    // An interrupted turn ends with an error result, but the transcript already shows the interruption.
    if (!this.interrupted) {
      if (result.subtype !== 'success') {
        this.emit(notice('error', result.errors.join('\n') || result.subtype))
      } else if (result.is_error) {
        this.emit(notice('error', result.result))
      }
    }
    this.interrupted = false
    this.emit({ type: 'statusChanged', status: 'idle' })
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
type ApiMessage = { id?: string; content: string | Block[] }

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

  constructor(private readonly cwd: string) {}

  map(message: Message | SDKMessage): AgentEvent[] {
    const parentId = (message as Message).parent_tool_use_id as string | null | undefined
    switch (message.type) {
      case 'stream_event':
        return this.mapStreamEvent((message as Message).event as Block, parentId ?? undefined)
      case 'assistant':
        return this.mapAssistant((message as Message).message as ApiMessage, parentId ?? undefined)
      case 'user':
        return this.mapUser(message as Message, parentId ?? undefined)
      case 'system':
        return (message as Message).subtype === 'compact_boundary'
          ? [notice('info', 'Conversation compacted')]
          : []
      default:
        return []
    }
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
    const text =
      typeof content === 'string'
        ? content
        : content
            .map((b) => (b.type === 'text' ? (b.text as string) : b.type === 'image' ? '[image]' : ''))
            .filter(Boolean)
            .join('\n')
    const events: AgentEvent[] = []
    if (text && !parentId) {
      // Claude Code records an interruption as a user message, live and in history.
      events.push(
        interruptionMarker.test(text)
          ? upsert({ kind: 'notice', id, level: 'info', text: 'Interrupted' })
          : upsert({ kind: 'userMessage', id, text }),
      )
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
