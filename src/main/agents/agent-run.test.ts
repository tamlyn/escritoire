import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AgentEvent, applyEvent, emptySessionView, type SessionView } from '../../shared/agent'
import { createClaudeAdapter } from './claude'
import { codexAdapter } from './codex'
import type { RpcMessage } from './codex-rpc'
import type { AgentRun } from './types'

/**
 * The `AgentRun` contract, run against each adapter with its agent faked at
 * the transport: the SDK's `query` for Claude, the JSON-RPC connection for Codex.
 */
type Harness = {
  start(emit: (event: AgentEvent) => void): AgentRun
  /** What the agent has been given to work on, in order. */
  sent(): string[]
  askPermission(): void
  /** As when a background task finishes. */
  startTurnItself(): void
  endTurn(): void
  say(text: string): void
  crash(message: string): void
  exit(): void
}

const fakes = vi.hoisted(() => ({
  claude: undefined as undefined | {
    sent: string[]
    put: (entry: { value?: object; error?: Error; done?: true }) => void
    nextTurn?: () => void
    canUseTool: (...args: unknown[]) => Promise<unknown>
  },
  codexClients: [] as {
    onMessage: (m: RpcMessage) => void
    onError: (e: Error) => void
  }[],
  codexCall: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: fakeQuery,
  getSessionMessages: async () => [],
  getSessionInfo: async () => undefined,
  listSessions: async () => [],
  forkSession: async () => ({ sessionId: 'fork' }),
}))

vi.mock('./codex-rpc', () => ({
  CodexRpc: class {
    onMessage = (_: RpcMessage) => {}
    onError = (_: Error) => {}
    initialize = async () => {}
    call = fakes.codexCall
    reply = () => {}
    unsupported = () => {}
    close = () => {}
    constructor() { fakes.codexClients.push(this) }
  },
}))

/** Like Claude Code, takes the next message only once the turn before it has ended. */
function fakeQuery({ prompt, options }: { prompt: AsyncIterable<{ message: { content: unknown } }>; options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }) {
  const queue: { value?: object; error?: Error; done?: true }[] = []
  let wake: (() => void) | undefined
  const fake: NonNullable<typeof fakes.claude> = {
    sent: [],
    put: (entry) => { queue.push(entry); wake?.() },
    canUseTool: options.canUseTool,
  }
  fakes.claude = fake
  void (async () => {
    for await (const { message } of prompt) {
      fake.sent.push(String(message.content))
      fake.put({ value: { type: 'stream_event', event: { type: 'message_start', message: { id: `msg-${fake.sent.length}` } }, parent_tool_use_id: null } })
      await new Promise<void>((resolve) => (fake.nextTurn = resolve))
    }
  })()
  async function* messages() {
    for (;;) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve))
      const { value, error, done } = queue.shift()!
      if (error) throw error
      if (done) return
      yield value
    }
  }
  const unavailable = async () => { throw new Error('Not faked') }
  return Object.assign(messages(), {
    interrupt: async () => {},
    // Messages already on their way can still arrive after closing.
    close: () => {},
    getContextUsage: unavailable,
    askSideQuestion: async () => ({ response: 'Ready', synthetic: false }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: unavailable,
  })
}

const claude: Harness = {
  start: (emit) => createClaudeAdapter().start({ cwd: '/project', agentSessionId: 'session', settings: {} }, emit),
  sent: () => fakes.claude!.sent,
  askPermission: () => {
    void fakes.claude!.canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 'tool', suggestions: [] })
  },
  startTurnItself: () => fakes.claude!.put({ value: { type: 'stream_event', event: { type: 'message_start', message: { id: 'own' } }, parent_tool_use_id: null } }),
  endTurn: () => {
    fakes.claude!.put({ value: { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 'session' } })
    fakes.claude!.nextTurn?.()
  },
  say: (text) => fakes.claude!.put({ value: { type: 'assistant', uuid: 'late', message: { id: 'late', content: [{ type: 'text', text }] }, parent_tool_use_id: null } }),
  crash: (message) => fakes.claude!.put({ error: new Error(message) }),
  exit: () => fakes.claude!.put({ done: true }),
}

const codexRpc = () => fakes.codexClients.at(-1)!
const codexTurns = () => fakes.codexCall.mock.calls.filter(([method]) => method === 'turn/start')

const codex: Harness = {
  start: (emit) => codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: {} }, emit),
  sent: () => codexTurns().map(([, params]) => params.input[0].text),
  askPermission: () => codexRpc().onMessage({ id: 41, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', itemId: 'cmd' } }),
  startTurnItself: () => codexRpc().onMessage({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'own' } } }),
  endTurn: () => codexRpc().onMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: `turn-${codexTurns().length}`, status: 'completed' } } }),
  say: (text) => codexRpc().onMessage({ method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'late', text } } }),
  crash: (message) => codexRpc().onError(new Error(message)),
  // The connection reports the process exiting as an error.
  exit: () => codexRpc().onError(new Error('Codex exited (0).')),
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const say = (text: string) => ({ text, images: [] })

beforeEach(() => {
  fakes.claude = undefined
  fakes.codexClients.length = 0
  fakes.codexCall.mockReset()
  fakes.codexCall.mockImplementation(async (method: string) => {
    if (method === 'turn/start') return { turn: { id: `turn-${codexTurns().length}` } }
    if (method === 'account/rateLimits/read') throw new Error('No plan')
    return {}
  })
})

describe('Claude plan approval', () => {
  let events: AgentEvent[]
  let run: AgentRun
  let directory: string
  let plan: { plan: string; planFilePath: string }
  const view = (): SessionView => events.reduce(applyEvent, emptySessionView)

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'escritoire-plan-'))
    plan = { plan: '1. Do it', planFilePath: join(directory, 'plan.md') }
    await writeFile(plan.planFilePath, plan.plan)
    events = []
    run = claude.start((event) => events.push(event))
    await tick()
    run.send(say('Plan it'))
    await tick()
  })

  afterEach(async () => {
    run.close()
    await rm(directory, { recursive: true, force: true })
  })

  function askToExitPlanMode() {
    return fakes.claude!.canUseTool('ExitPlanMode', plan, { signal: new AbortController().signal, toolUseID: 'toolu_plan' })
  }

  it('shows the plan and approves it in the mode chosen', async () => {
    const decision = askToExitPlanMode()
    await tick()
    expect(view().items.at(-1)).toEqual({ kind: 'plan', id: 'toolu_plan', text: '1. Do it', path: plan.planFilePath })
    const [request] = view().requests
    expect(request).toMatchObject({ kind: 'permission', view: null })

    run.respond(request!.id, { kind: 'permission', optionId: 'auto' })

    expect(await decision).toEqual({
      behavior: 'allow',
      updatedInput: plan,
      updatedPermissions: [{ type: 'setMode', mode: 'auto', destination: 'session' }],
    })
  })

  it('approves the plan as the user has since edited its file', async () => {
    const decision = askToExitPlanMode()
    await tick()
    await writeFile(plan.planFilePath, '1. Do it properly')

    run.respond(view().requests[0]!.id, { kind: 'permission', optionId: 'default' })

    expect(await decision).toMatchObject({ behavior: 'allow', updatedInput: { ...plan, plan: '1. Do it properly' } })
    expect(view().items.at(-1)).toMatchObject({ kind: 'plan', text: '1. Do it properly' })
  })

  it('stops the turn quietly to keep planning', async () => {
    const decision = askToExitPlanMode()
    await tick()

    run.respond(view().requests[0]!.id, { kind: 'permission', optionId: 'deny' })
    expect(await decision).toMatchObject({ behavior: 'deny', interrupt: true })
    fakes.claude!.put({ value: { type: 'result', subtype: 'error_during_execution', errors: [], is_error: true, session_id: 'session' } })
    await tick()

    expect(view().items.filter((item) => item.kind === 'notice')).toEqual([])
    expect(view().status).toBe('idle')
  })
})

describe('Claude rewarm', () => {
  it('asks a side question, adding nothing to the conversation, and renews the cache', async () => {
    const events: AgentEvent[] = []
    const usage = { contextTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, at: 0 }
    const run = createClaudeAdapter().start({ cwd: '/project', agentSessionId: 'session', settings: {}, usage }, (event) => events.push(event))
    await tick()

    await run.rewarm()

    expect(fakes.claude!.sent).toEqual([])
    expect(events).toEqual([{ type: 'usageChanged', usage: { ...usage, at: expect.any(Number) } }])
    expect((events[0] as Extract<AgentEvent, { type: 'usageChanged' }>).usage.at).toBeGreaterThan(0)
    run.close()
  })
})

describe.each([
  ['Claude', claude],
  ['Codex', codex],
])('%s run', (_, agent) => {
  let events: AgentEvent[]
  let run: AgentRun
  const view = (): SessionView => events.reduce(applyEvent, emptySessionView)
  const statuses = () => events.flatMap((event) => (event.type === 'statusChanged' ? [event.status] : []))

  beforeEach(async () => {
    events = []
    run = agent.start((event) => events.push(event))
    await tick()
  })

  afterEach(() => run.close())

  it('reports a turn as working, then idle', async () => {
    run.send(say('Hello'))
    await tick()
    agent.endTurn()
    await tick()

    expect(agent.sent()).toEqual(['Hello'])
    expect(statuses()).toEqual(['working', 'idle'])
  })

  it('reports a turn the agent starts itself as working, then idle', async () => {
    agent.startTurnItself()
    await tick()
    expect(statuses()).toEqual(['working'])

    agent.endTurn()
    await tick()

    expect(statuses()).toEqual(['working', 'idle'])
  })

  it('gives the agent a message sent during a turn once the turn ends', async () => {
    run.send(say('First'))
    await tick()
    run.send(say('Second'))
    await tick()
    expect(agent.sent()).toEqual(['First'])

    agent.endTurn()
    await tick()

    expect(agent.sent()).toEqual(['First', 'Second'])
    expect(statuses()).toEqual(['working', 'idle', 'working'])
  })

  it('resolves pending requests and reports a failure, then emits nothing more', async () => {
    run.send(say('Hello'))
    agent.askPermission()
    await tick()
    expect(view().requests).toHaveLength(1)

    agent.crash('Out of memory')
    await tick()
    const failed = events.length
    agent.say('Too late')
    agent.endTurn()
    await tick()

    expect(view()).toMatchObject({ status: 'errored', error: 'Out of memory', requests: [] })
    expect(events).toHaveLength(failed)
  })

  it('resolves pending requests and reports the agent exiting as a failure', async () => {
    run.send(say('Hello'))
    agent.askPermission()
    await tick()
    expect(view().requests).toHaveLength(1)

    agent.exit()
    await tick()

    expect(view()).toMatchObject({ status: 'errored', requests: [] })
  })

  it('emits nothing once closed', async () => {
    run.send(say('Hello'))
    agent.askPermission()
    await tick()
    const before = events.length

    run.close()
    agent.say('Too late')
    agent.crash('Gone')
    await tick()

    expect(events).toHaveLength(before)
  })
})
