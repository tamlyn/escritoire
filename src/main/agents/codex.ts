import type { AgentEvent, ContextUsage, Item, PlanLimit, RequestResponse, SessionSettings, SlashCommand, ToolStatus, UserInput } from '../../shared/agent'
import type { ReviewStartResponse } from './codex-protocol/v2/ReviewStartResponse'
import type { ReviewTarget } from './codex-protocol/v2/ReviewTarget'
import type { SkillMetadata } from './codex-protocol/v2/SkillMetadata'
import type { SkillsListResponse } from './codex-protocol/v2/SkillsListResponse'
import type { ThreadItem } from './codex-protocol/v2/ThreadItem'
import type { ThreadListResponse } from './codex-protocol/v2/ThreadListResponse'
import type { ThreadTurnsListResponse } from './codex-protocol/v2/ThreadTurnsListResponse'
import type { ThreadStartResponse } from './codex-protocol/v2/ThreadStartResponse'
import type { TurnStartResponse } from './codex-protocol/v2/TurnStartResponse'
import type { ModelListResponse } from './codex-protocol/v2/ModelListResponse'
import type { ThreadTokenUsage } from './codex-protocol/v2/ThreadTokenUsage'
import type { AccountRateLimitsUpdatedNotification } from './codex-protocol/v2/AccountRateLimitsUpdatedNotification'
import type { GetAccountRateLimitsResponse } from './codex-protocol/v2/GetAccountRateLimitsResponse'
import type { RateLimitSnapshot } from './codex-protocol/v2/RateLimitSnapshot'
import type { RateLimitWindow } from './codex-protocol/v2/RateLimitWindow'
import type { ThreadSettingsUpdatedNotification } from './codex-protocol/v2/ThreadSettingsUpdatedNotification'
import type { AskForApproval } from './codex-protocol/v2/AskForApproval'
import type { SandboxMode } from './codex-protocol/v2/SandboxMode'
import type { SandboxPolicy } from './codex-protocol/v2/SandboxPolicy'
import { CodexRpc, type RpcMessage } from './codex-rpc'
import type { AgentAdapter, AgentRun, StartOptions } from './types'

async function using<T>(cwd: string, fn: (rpc: CodexRpc) => Promise<T>): Promise<T> {
  const rpc = new CodexRpc(cwd)
  rpc.onMessage = (m) => { if (m.id !== undefined) rpc.unsupported(m.id) }
  try { await rpc.initialize(); return await fn(rpc) } finally { rpc.close() }
}

// Codex only writes a rollout after the first turn. Keep newly created threads
// alive until the run adopts their connection.
const freshThreads = new Map<string, { rpc: CodexRpc; resolved: Resolved }>()

// Codex's own presets. The sandbox has to be chosen with the approval policy:
// in a read-only sandbox "on-request" runs any command unasked but asks to edit.
const modes = {
  'read-only': { label: 'Read only', approvalPolicy: 'on-request', sandbox: 'read-only' },
  auto: { label: 'Auto', approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  'full-access': { label: 'Full access', approvalPolicy: 'never', sandbox: 'danger-full-access' },
} satisfies Record<string, { label: string; approvalPolicy: AskForApproval; sandbox: SandboxMode }>

type Mode = (typeof modes)[keyof typeof modes]
const modeFor = (id: string | null | undefined): Mode | undefined => id && Object.hasOwn(modes, id) ? modes[id as keyof typeof modes] : undefined

type Resolved = Pick<ThreadStartResponse, 'model' | 'approvalPolicy' | 'sandbox' | 'reasoningEffort'>

export const codexAdapter: AgentAdapter = {
  kind: 'codex',
  async createSession(cwd, ide) {
    const rpc = new CodexRpc(cwd)
    try {
      await rpc.initialize()
      const result = await rpc.call<ThreadStartResponse>('thread/start', { cwd, ...ideConfig(ide) })
      freshThreads.set(result.thread.id, { rpc, resolved: result })
      return result.thread.id
    } catch (e) { rpc.close(); throw e }
  },
  closeSession(id) { freshThreads.get(id)?.rpc.close(); freshThreads.delete(id) },
  dispose() { for (const { rpc } of freshThreads.values()) rpc.close(); freshThreads.clear() },
  listSessions: (cwd) => using(cwd, async (rpc) => {
    const sessions = []
    let cursor: string | null = null
    do {
      const page: ThreadListResponse = await rpc.call('thread/list', { cwd, cursor, sourceKinds: [] })
      sessions.push(...page.data.map((s) => ({ agent: 'codex' as const, agentSessionId: s.id, title: s.name || s.preview, lastActiveAt: s.updatedAt * 1000 })))
      cursor = page.nextCursor
    } while (cursor)
    return sessions
  }),
  loadHistory: (threadId, cwd) => freshThreads.has(threadId) ? Promise.resolve({ items: [], settings: resolvedSettings(freshThreads.get(threadId)!.resolved) }) : using(cwd, async (rpc) => {
    let usage: ContextUsage | undefined
    rpc.onMessage = (m) => {
      if (m.method === 'thread/tokenUsage/updated' && m.params?.threadId === threadId) usage = contextUsage(m.params.tokenUsage as ThreadTokenUsage)
      else if (m.id !== undefined) rpc.unsupported(m.id)
    }
    let result: ThreadStartResponse
    try {
      result = await rpc.call<ThreadStartResponse>('thread/resume', { threadId, excludeTurns: true })
    } catch (e) {
      // The run starts a new thread in its place.
      if (isUnsaved(e)) return { items: [] }
      throw e
    }
    const items: Item[] = []
    let cursor: string | null = null
    do {
      const page: ThreadTurnsListResponse = await rpc.call('thread/turns/list', { threadId, cursor, itemsView: 'full', sortDirection: 'asc' })
      for (const turn of page.data) items.push(...turn.items.map(codexItem))
      cursor = page.nextCursor
    } while (cursor)
    return { items, settings: resolvedSettings(result), ...(usage ? { usage } : {}) }
  }),
  settingChoices: (cwd) => using(cwd, async (rpc) => {
    const models: ModelListResponse['data'] = []
    let cursor: string | null = null
    do {
      const page: ModelListResponse = await rpc.call('model/list', { cursor })
      models.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return {
      models: [{ id: 'default', label: 'Default', efforts: models.find((m) => m.isDefault)?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [] }, ...models.map((m) => ({ id: m.model, label: m.displayName, description: m.description, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) }))],
      permissionModes: Object.entries(modes).map(([id, { label }]) => ({ id, label })),
    }
  }),
  listCommands: (cwd) => using(cwd, async (rpc) => {
    const skills = (await listSkills(rpc, cwd))
      .filter((skill) => !builtInCommands.some((command) => command.name === skill.name))
      .map((skill) => ({ name: skill.name, description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description }))
    return [...builtInCommands, ...skills]
  }),
  start: (options, emit) => new CodexRun(options, emit),
}

// Codex's own slash commands belong to its TUI; these are the ones app-server can run.
const builtInCommands: SlashCommand[] = [
  { name: 'clear', description: 'Start a new conversation in this tab' },
  { name: 'compact', description: 'Summarise the conversation to free up context' },
  { name: 'review', description: 'Review uncommitted changes, or what the instructions ask for', argumentHint: '[instructions]' },
]

// Codex only writes a thread's rollout after its first turn, so a thread the
// app quit before using can't be resumed.
const isUnsaved = (error: unknown) => error instanceof Error && error.message.startsWith('no rollout found')

// A long-lived app-server caches skills, and would miss one added since.
async function listSkills(rpc: CodexRpc, cwd: string): Promise<SkillMetadata[]> {
  const result = await rpc.call<SkillsListResponse>('skills/list', { cwds: [cwd], forceReload: true })
  return result.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled)
}

function parseCommand(text: string): { name: string; args: string } | null {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
  return match ? { name: match[1]!, args: match[2]!.trim() } : null
}

function resolvedSettings(result: Resolved): SessionSettings {
  const sandbox = sandboxMode(result.sandbox)
  const mode = Object.entries(modes).find(([, m]) => m.sandbox === sandbox && m.approvalPolicy === result.approvalPolicy)
  return {
    ...(result.model ? { model: result.model } : {}),
    ...(result.approvalPolicy && result.sandbox ? { permissionMode: mode?.[0] ?? 'custom' } : {}),
    ...(result.reasoningEffort !== undefined ? { effort: result.reasoningEffort } : {}),
  }
}

function sandboxMode(policy: SandboxPolicy | undefined): SandboxMode | undefined {
  switch (policy?.type) {
    case 'readOnly': return 'read-only'
    case 'workspaceWrite': return 'workspace-write'
    case 'dangerFullAccess': return 'danger-full-access'
    default: return undefined
  }
}

// Only sent when switching sandbox mid-run, since it replaces the user's
// configured details (network access, extra writable roots).
function sandboxPolicy(mode: SandboxMode): SandboxPolicy {
  switch (mode) {
    case 'read-only': return { type: 'readOnly', networkAccess: false }
    case 'workspace-write': return { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
    case 'danger-full-access': return { type: 'dangerFullAccess' }
  }
}

function contextUsage(usage: ThreadTokenUsage): ContextUsage {
  return {
    contextTokens: usage.last.totalTokens,
    ...(usage.modelContextWindow ? { contextWindow: usage.modelContextWindow } : {}),
    cacheReadTokens: usage.last.cachedInputTokens,
    cacheWriteTokens: usage.last.cacheWriteInputTokens ?? 0,
    at: Date.now(),
  }
}

/** Updates are sparse: a window they leave out keeps its last value. */
function mergeRateLimits(previous: RateLimitSnapshot | undefined, next: RateLimitSnapshot): RateLimitSnapshot {
  return { ...next, primary: next.primary ?? previous?.primary ?? null, secondary: next.secondary ?? previous?.secondary ?? null }
}

export function planLimits(snapshot: RateLimitSnapshot): PlanLimit[] {
  return [snapshot.primary, snapshot.secondary]
    .filter((window): window is RateLimitWindow => window !== null)
    .map((window) => ({ label: windowLabel(window.windowDurationMins), usedPercent: window.usedPercent, resetsAt: window.resetsAt && window.resetsAt * 1000 }))
}

function windowLabel(minutes: number | null): string {
  if (minutes === 300) return 'Current session'
  if (minutes === 7 * 24 * 60) return 'Weekly'
  if (!minutes) return 'Usage'
  return minutes % (24 * 60) === 0 ? `${minutes / (24 * 60)}-day` : `${Math.round(minutes / 60)}-hour`
}

function ideConfig(ide: StartOptions['ide']) {
  return ide ? {
    config: { mcp_servers: { escritoire: { url: ide.url, http_headers: ide.headers } } },
    developerInstructions: 'Use the escritoire MCP supervisor tools for long-running processes and background commands so the user can see and control them. Check list_processes before starting a process.',
  } : {}
}

const status = (s: string): ToolStatus => s === 'inProgress' ? 'running' : s === 'completed' ? 'completed' : 'failed'

/** Completed items are authoritative, using precisely the same mapper for history. */
export function codexItem(item: ThreadItem): Item {
  switch (item.type) {
    case 'userMessage': return { kind: 'userMessage', id: item.id, text: item.content.flatMap((c) => c.type === 'text' ? [c.text] : []).join('\n'), images: item.content.flatMap((c) => {
      if (c.type !== 'image' || !('url' in c)) return []
      const match = /^data:([^;]+);base64,(.*)$/.exec(c.url)
      return match ? [{ mediaType: match[1]!, data: match[2]! }] : []
    }) }
    case 'agentMessage': return { kind: 'agentMessage', id: item.id, text: item.text }
    case 'plan': return { kind: 'agentMessage', id: item.id, text: item.text }
    case 'reasoning': return { kind: 'reasoning', id: item.id, text: (item.summary.length ? item.summary : item.content).join('\n\n') }
    case 'commandExecution': return { kind: 'toolCall', id: item.id, status: status(item.status), title: item.command, view: { type: 'command', command: item.command, output: item.aggregatedOutput ?? '' } }
    case 'fileChange': return { kind: 'toolCall', id: item.id, status: status(item.status), title: 'File changes', view: { type: 'fileChange', changes: item.changes.map((c) => ({ path: c.path, diff: c.diff })) } }
    case 'mcpToolCall': return { kind: 'toolCall', id: item.id, status: status(item.status), title: `${item.server}: ${item.tool}`, view: { type: 'generic', name: item.tool, input: item.arguments, output: JSON.stringify(item.error ?? item.result, null, 2) } }
    case 'contextCompaction': return { kind: 'notice', id: item.id, level: 'info', text: 'Context compacted' }
    case 'enteredReviewMode': return { kind: 'notice', id: item.id, level: 'info', text: `Reviewing ${item.review}` }
    case 'exitedReviewMode': return { kind: 'agentMessage', id: item.id, text: item.review }
    default: return { kind: 'unknown', id: item.id, label: item.type, raw: item }
  }
}

class CodexRun implements AgentRun {
  private rpc: CodexRpc
  private ready: Promise<unknown>
  private closed = false
  private turnId?: string
  private interruptRequested = false
  private starting = false
  private completedTurns = new Set<string>()
  private queue: UserInput[] = []
  private settings: SessionSettings
  private sandbox?: SandboxMode
  private rateLimits?: RateLimitSnapshot
  private items = new Map<string, Item>()
  /** Starts as the session's thread; `/clear` moves the run to a new one. */
  private threadId: string
  private requests = new Map<string, { id: number | string; method: string; params: Record<string, unknown> }>()
  /** Settles a `/compact`, whose turn is only announced by `turn/started`. */
  private turnStarted?: (turnId: string) => void

  constructor(private options: StartOptions, private emit: (event: AgentEvent) => void) {
    this.threadId = options.agentSessionId
    this.settings = { ...options.settings }
    const fresh = freshThreads.get(options.agentSessionId)
    freshThreads.delete(options.agentSessionId)
    this.rpc = fresh?.rpc ?? new CodexRpc(options.cwd)
    this.rpc.onError = (e) => this.fail(e)
    this.rpc.onMessage = (m) => this.message(m)
    this.ready = fresh ? Promise.resolve().then(() => this.adopt(fresh.resolved)) : this.rpc.initialize().then(() => this.resume())
    void this.ready.catch((e: unknown) => this.fail(e))
    void this.ready.then(() => this.readRateLimits()).catch(() => {})
  }
  private async readRateLimits(): Promise<void> {
    // An API key login has no plan limits, and the read fails.
    const result = await this.rpc.call<GetAccountRateLimitsResponse>('account/rateLimits/read', undefined)
    this.updateRateLimits(result.rateLimits)
  }
  private updateRateLimits(snapshot: RateLimitSnapshot): void {
    // Other buckets, such as a model's own, are left out of the summary.
    if (this.rateLimits?.limitId && snapshot.limitId && snapshot.limitId !== this.rateLimits.limitId) return
    this.rateLimits = mergeRateLimits(this.rateLimits, snapshot)
    if (!this.closed) this.emit({ type: 'limitsChanged', limits: planLimits(this.rateLimits) })
  }
  private async resume(): Promise<void> {
    const mode = modeFor(this.settings.permissionMode)
    try {
      this.adopt(await this.rpc.call<ThreadStartResponse>('thread/resume', {
        threadId: this.threadId, cwd: this.options.cwd, excludeTurns: true,
        ...(mode ? { approvalPolicy: mode.approvalPolicy, sandbox: mode.sandbox } : {}),
        ...ideConfig(this.options.ide),
      }))
    } catch (e) {
      if (!isUnsaved(e)) throw e
      await this.startThread()
    }
  }
  send(input: UserInput): void { if (!this.closed) { this.queue.push(input); void this.drain() } }
  private async drain(): Promise<void> {
    if (this.closed || this.starting || this.turnId || !this.queue.length) return
    this.starting = true
    this.interruptRequested = false
    const input = this.queue.shift()!
    this.emit({ type: 'statusChanged', status: 'working' })
    try {
      await this.ready
      if (this.closed) return
      if (parseCommand(input.text)?.name === 'clear') {
        await this.startThread()
        this.emit({ type: 'statusChanged', status: 'idle' })
        void Promise.resolve().then(() => this.drain())
        return
      }
      const turn = await this.startTurn(input)
      if (!this.completedTurns.has(turn.id)) this.turnId ??= turn.id
      if (this.interruptRequested && this.turnId) await this.interrupt()
    } catch (e) { this.fail(e) } finally { this.starting = false }
  }
  /** Moves the run to a new thread. */
  private async startThread(): Promise<void> {
    const mode = modeFor(this.settings.permissionMode)
    const result = await this.rpc.call<ThreadStartResponse>('thread/start', {
      cwd: this.options.cwd,
      ...(mode ? { approvalPolicy: mode.approvalPolicy, sandbox: mode.sandbox } : {}),
      ...ideConfig(this.options.ide),
    })
    if (this.closed) return
    this.threadId = result.thread.id
    this.emit({ type: 'conversationReset', agentSessionId: this.threadId })
    this.adopt(result)
  }
  private async startTurn(input: UserInput): Promise<{ id: string }> {
    const threadId = this.threadId
    const command = parseCommand(input.text)
    if (command?.name === 'compact') {
      const started = new Promise<string>((resolve) => { this.turnStarted = resolve })
      await this.rpc.call('thread/compact/start', { threadId })
      return { id: await started }
    }
    if (command?.name === 'review') {
      const target: ReviewTarget = command.args ? { type: 'custom', instructions: command.args } : { type: 'uncommittedChanges' }
      return (await this.rpc.call<ReviewStartResponse>('review/start', { threadId, target })).turn
    }
    const skill = command && (await listSkills(this.rpc, this.options.cwd)).find((s) => s.name === command.name)
    const mode = modeFor(this.settings.permissionMode)
    const result = await this.rpc.call<TurnStartResponse>('turn/start', {
      threadId,
      input: [
        { type: 'text', text: input.text, text_elements: [] },
        ...(skill ? [{ type: 'skill', name: skill.name, path: skill.path }] : []),
        ...input.images.map((i) => ({ type: 'image', url: `data:${i.mediaType};base64,${i.data}` })),
      ],
      model: this.settings.model ?? null, effort: this.settings.effort ?? null,
      ...(mode ? { approvalPolicy: mode.approvalPolicy, ...(mode.sandbox !== this.sandbox ? { sandboxPolicy: sandboxPolicy(mode.sandbox) } : {}) } : {}),
    })
    // The override lasts for the thread, whether or not Codex reports it.
    if (mode) this.sandbox = mode.sandbox
    return result.turn
  }
  async interrupt(): Promise<void> {
    this.queue = []
    this.interruptRequested = true
    if (this.turnId) await this.rpc.call('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }
  respond(requestId: string, response: RequestResponse): void {
    const request = this.requests.get(requestId)
    if (!request) return
    let result: unknown
    if (request.method === 'item/tool/requestUserInput' && response.kind === 'question') {
      const questions = request.params.questions as { id: string; question: string }[]
      result = { answers: Object.fromEntries(questions.map((q) => [q.id, { answers: response.answers?.[q.question] ? [response.answers[q.question]] : [] }])) }
    } else if (response.kind === 'permission') {
      result = request.method === 'mcpServer/elicitation/request' ? { action: response.optionId === 'accept' ? 'accept' : 'decline', content: {} } : { decision: response.optionId }
    } else return
    this.rpc.reply(request.id, result)
    this.resolve(requestId)
  }
  async changeSettings(settings: SessionSettings): Promise<void> { this.settings = { ...this.settings, ...settings } }
  async stopTask(): Promise<void> { throw new Error('Codex does not expose task stopping here. Interrupt the turn instead.') }
  close(): void { this.closed = true; this.queue = []; this.rpc.close() }
  private adopt(resolved: Resolved): void {
    this.sandbox = sandboxMode(resolved.sandbox)
    if (!this.closed) this.emit({ type: 'settingsChanged', settings: resolvedSettings(resolved) })
  }
  private resolve(id: string): void { this.requests.delete(id); this.emit({ type: 'requestResolved', requestId: id }) }
  private fail(error: unknown): void {
    if (this.closed) return
    for (const id of this.requests.keys()) this.resolve(id)
    this.close()
    this.emit({ type: 'statusChanged', status: 'errored', error: error instanceof Error ? error.message : String(error) })
  }
  private message(m: RpcMessage): void {
    if (this.closed) return
    const p = m.params ?? {}
    if (p.threadId && p.threadId !== this.threadId) return
    if (m.id !== undefined && m.method) { this.request(m.id, m.method, p); return }
    switch (m.method) {
      case 'thread/tokenUsage/updated':
        this.emit({ type: 'usageChanged', usage: contextUsage(p.tokenUsage as ThreadTokenUsage) }); break
      case 'account/rateLimits/updated':
        this.updateRateLimits((p as unknown as AccountRateLimitsUpdatedNotification).rateLimits); break
      case 'thread/settings/updated': {
        const settings = (p as unknown as ThreadSettingsUpdatedNotification).threadSettings
        this.adopt({ ...settings, sandbox: settings.sandboxPolicy, reasoningEffort: settings.effort }); break
      }
      case 'turn/started': {
        this.turnId = (p.turn as { id: string }).id
        this.turnStarted?.(this.turnId)
        this.turnStarted = undefined
        break
      }
      case 'turn/completed': {
        this.turnId = undefined
        for (const id of this.requests.keys()) this.resolve(id)
        const turn = p.turn as { id: string; status: string; error?: { message: string } }
        this.completedTurns.add(turn.id)
        if (turn.status === 'failed') { this.fail(new Error(turn.error?.message ?? 'Codex turn failed')); return }
        this.emit({ type: 'statusChanged', status: 'idle' })
        // Start only after a pending turn/start response has been consumed.
        void Promise.resolve().then(async () => { while (this.starting && !this.closed) await new Promise((r) => setTimeout(r, 0)); await this.drain() })
        break
      }
      case 'item/started': case 'item/completed': {
        const item = codexItem(p.item as ThreadItem)
        this.items.set(item.id, item)
        this.emit({ type: 'itemUpserted', item }); break
      }
      case 'item/agentMessage/delta': case 'item/reasoning/summaryTextDelta': case 'item/commandExecution/outputDelta': case 'item/plan/delta':
        this.emit({ type: 'textAppended', itemId: String(p.itemId), text: String(p.delta ?? '') }); break
      case 'serverRequest/resolved': this.resolve(String(p.requestId)); break
      case 'error': if (!p.willRetry) this.fail(new Error((p.error as { message?: string })?.message ?? 'Codex error')); break
    }
  }
  private request(id: number | string, method: string, p: Record<string, unknown>): void {
    if (method === 'mcpServer/elicitation/request' && this.options.ide && p.serverName === 'escritoire' && (p._meta as Record<string, unknown> | undefined)?.codex_approval_kind === 'mcp_tool_call') {
      this.rpc.reply(id, { action: 'accept', content: {} }); return
    }
    const key = String(id)
    if (method === 'item/tool/requestUserInput') {
      this.requests.set(key, { id, method, params: p })
      const questions = p.questions as { question: string; header: string; options?: { label: string; description?: string }[] }[]
      this.emit({ type: 'requestAdded', request: { kind: 'question', id: key, questions: questions.map((q) => ({ ...q, options: q.options ?? [], multiSelect: false })) } }); return
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'mcpServer/elicitation/request'].includes(method)) { this.rpc.unsupported(id); return }
    this.requests.set(key, { id, method, params: p })
    const item = this.items.get(String(p.itemId))
    const elicitation = method === 'mcpServer/elicitation/request'
    this.emit({ type: 'requestAdded', request: {
      kind: 'permission', id: key, itemId: p.itemId as string | undefined,
      title: String(p.reason ?? p.message ?? 'Codex requests permission'),
      view: item?.kind === 'toolCall' ? item.view : { type: 'generic', name: method, input: p },
      options: [{ id: 'accept', label: 'Allow once', kind: 'allowOnce' }, ...(!elicitation ? [{ id: 'acceptForSession', label: 'Allow for session', kind: 'allowAlways' as const }] : []), { id: 'decline', label: 'Deny', kind: 'deny' }],
    } })
  }
}
