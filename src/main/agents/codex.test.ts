import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvent, emptySessionView, type SessionView } from '../../shared/agent'
import type { RpcMessage } from './codex-rpc'
import { codexAdapter, codexItem } from './codex'
import type { ThreadItem } from './codex-protocol/v2/ThreadItem'

const mocks = vi.hoisted(() => ({ clients: [] as any[], call: vi.fn() }))
vi.mock('./codex-rpc', () => ({ CodexRpc: class {
  onMessage = (_: RpcMessage) => {}
  onError = (_: Error) => {}
  initialize = vi.fn(async () => {})
  call = mocks.call
  reply = vi.fn()
  unsupported = vi.fn()
  close = vi.fn()
  constructor() { mocks.clients.push(this) }
} }))
const tick = async () => { await new Promise((r) => setTimeout(r, 10)) }

beforeEach(() => { mocks.clients.length = 0; mocks.call.mockReset() })

describe('Codex adapter', () => {
  it('reports effective settings on open and live context usage without cumulative totals', async () => {
    const effective = { model: 'actual-model', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' }, reasoningEffort: 'high' }
    mocks.call.mockImplementation(async (method: string) => method === 'thread/start' ? { thread: { id: 'usage-thread' }, ...effective } : { turn: { id: 'turn' } })
    const id = await codexAdapter.createSession('/project')
    expect((await codexAdapter.loadHistory(id, '/project')).settings).toEqual({ model: 'actual-model', permissionMode: 'read-only', effort: 'high' })
    let view: SessionView = { ...emptySessionView }
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: id, settings: {} }, (e) => { view = applyEvent(view, e) })
    run.send({ text: 'Hi', images: [] }); await tick()
    expect(view.settings).toEqual({ model: 'actual-model', permissionMode: 'read-only', effort: 'high' })
    const client = mocks.clients[0]
    client.onMessage({ method: 'thread/tokenUsage/updated', params: { threadId: id, tokenUsage: { last: { totalTokens: 25000, cachedInputTokens: 20000 }, total: { totalTokens: 100000 }, modelContextWindow: 100000 } } })
    expect(view.usage).toMatchObject({ contextTokens: 25000, contextWindow: 100000, cacheReadTokens: 20000, cacheWriteTokens: 0 })
    client.onMessage({ method: 'thread/settings/updated', params: { threadId: id, threadSettings: { model: 'new-model', approvalPolicy: 'untrusted', sandboxPolicy: { type: 'readOnly' }, effort: 'low' } } })
    expect(view.settings).toEqual({ model: 'new-model', permissionMode: 'custom', effort: 'low' })
    run.close()
  })

  it('runs slash commands as compaction, review or a skill', async () => {
    const skill = { name: 'imagegen', description: 'Make images', path: '/skills/imagegen/SKILL.md', enabled: true }
    mocks.call.mockImplementation(async (method: string) => {
      if (method === 'skills/list') return { data: [{ cwd: '/project', skills: [skill], errors: [] }] }
      if (method === 'thread/compact/start') return {}
      return { turn: { id: method } }
    })
    expect(await codexAdapter.listCommands('/project')).toEqual([
      expect.objectContaining({ name: 'clear' }),
      expect.objectContaining({ name: 'compact' }),
      expect.objectContaining({ name: 'review' }),
      { name: 'imagegen', description: 'Make images' },
    ])
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: {} }, () => {})
    const finish = (turnId: string) => mocks.clients.at(-1).onMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: turnId, status: 'completed' } } })
    run.send({ text: '/compact', images: [] }); await tick()
    expect(mocks.call).toHaveBeenCalledWith('thread/compact/start', { threadId: 'thread' })
    mocks.clients.at(-1).onMessage({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'compaction' } } })
    finish('compaction'); await tick()
    run.send({ text: '/review focus on errors', images: [] }); await tick()
    expect(mocks.call).toHaveBeenCalledWith('review/start', { threadId: 'thread', target: { type: 'custom', instructions: 'focus on errors' } })
    finish('review/start'); await tick()
    run.send({ text: '/imagegen a cat', images: [] }); await tick()
    expect(mocks.call.mock.calls.find(([m]) => m === 'turn/start')![1].input).toEqual([
      { type: 'text', text: '/imagegen a cat', text_elements: [] },
      { type: 'skill', name: 'imagegen', path: '/skills/imagegen/SKILL.md' },
    ])
    run.close()
  })

  it('moves to a new thread in the same mode on /clear', async () => {
    mocks.call.mockImplementation(async (method: string) => method === 'thread/start'
      ? { thread: { id: 'cleared' }, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
      : { turn: { id: 'turn' } })
    const events: unknown[] = []
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: { permissionMode: 'full-access' } }, (e) => events.push(e))
    run.send({ text: '/clear', images: [] })
    run.send({ text: 'Hello', images: [] }); await tick()
    expect(mocks.call).toHaveBeenCalledWith('thread/start', expect.objectContaining({ cwd: '/project', approvalPolicy: 'never', sandbox: 'danger-full-access' }))
    expect(events).toContainEqual({ type: 'conversationReset', agentSessionId: 'cleared' })
    expect(mocks.call.mock.calls.find(([m]) => m === 'turn/start')![1]).toMatchObject({ threadId: 'cleared' })
    run.close()
  })

  it('restores the resolved model and mode from resume', async () => {
    mocks.call.mockResolvedValueOnce({ model: 'restored-model', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, reasoningEffort: 'medium' }).mockResolvedValueOnce({ data: [], nextCursor: null })
    const history = await codexAdapter.loadHistory('existing', '/project')
    expect(history.settings).toEqual({ model: 'restored-model', permissionMode: 'full-access', effort: 'medium' })
  })

  it('resumes in the chosen mode and switches sandbox only when the mode changes it', async () => {
    mocks.call.mockImplementation(async (method: string) => method === 'thread/resume'
      ? { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite', networkAccess: true } }
      : { turn: { id: 'turn' } })
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: { permissionMode: 'auto' } }, () => {})
    run.send({ text: 'Hello', images: [] }); await tick()
    expect(mocks.call).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ approvalPolicy: 'on-request', sandbox: 'workspace-write' }))
    const firstTurn = mocks.call.mock.calls.find(([m]) => m === 'turn/start')![1]
    expect(firstTurn).toMatchObject({ approvalPolicy: 'on-request' })
    expect(firstTurn).not.toHaveProperty('sandboxPolicy')
    mocks.clients[0].onMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } })
    await run.changeSettings({ permissionMode: 'full-access' })
    run.send({ text: 'Again', images: [] }); await tick()
    expect(mocks.call.mock.calls.filter(([m]) => m === 'turn/start')[1]![1]).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } })
    run.close()
  })

  it('adopts an unpersisted new thread without resuming it', async () => {
    mocks.call.mockImplementation(async (method: string) => method === 'thread/start' ? { thread: { id: 'fresh' } } : { turn: { id: 'turn' } })
    const id = await codexAdapter.createSession('/project')
    expect(await codexAdapter.loadHistory(id, '/project')).toEqual({ items: [], settings: {} })
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: id, settings: {} }, () => {})
    run.send({ text: 'Hello', images: [] }); await tick()
    expect(mocks.clients).toHaveLength(1)
    expect(mocks.call.mock.calls.map(([m]) => m)).toEqual(['thread/start', 'turn/start'])
    run.close()
  })

  it('loads every history page in order with the live mapper', async () => {
    const item = { type: 'agentMessage', id: 'a', text: 'Hello' } as ThreadItem
    mocks.call.mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [{ items: [item] }], nextCursor: 'next' }).mockResolvedValueOnce({ data: [{ items: [{ type: 'plan', id: 'b', text: 'Plan' }] }], nextCursor: null })
    const history = await codexAdapter.loadHistory('thread', '/project')
    expect(history.items).toEqual([codexItem(item), { kind: 'agentMessage', id: 'b', text: 'Plan' }])
    expect(mocks.call.mock.calls[2]![1]).toMatchObject({ cursor: 'next', sortDirection: 'asc', itemsView: 'full' })
    expect(mocks.clients[0].close).toHaveBeenCalled()
  })

  it('streams, queues, approves, and clears requests on failure', async () => {
    mocks.call.mockImplementation(async (method: string) => method === 'turn/start' ? { turn: { id: 'turn' } } : {})
    let view: SessionView = { ...emptySessionView }
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: {}, ide: { url: 'http://localhost/mcp', headers: { Authorization: 'Bearer test' } } }, (e) => { view = applyEvent(view, e) })
    run.send({ text: 'Hello', images: [] }); await tick()
    const client = mocks.clients[0]
    expect(mocks.call.mock.calls[0]).toEqual(['thread/resume', expect.objectContaining({ config: { mcp_servers: { escritoire: { url: 'http://localhost/mcp', http_headers: { Authorization: 'Bearer test' } } } } })])
    client.onMessage({ method: 'item/started', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'a', text: '' } } })
    client.onMessage({ method: 'item/agentMessage/delta', params: { threadId: 'thread', itemId: 'a', delta: 'Hello' } })
    expect(view.items[0]).toMatchObject({ text: 'Hello' })
    run.send({ text: 'Second', images: [] }); await tick()
    expect(mocks.call.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1)
    client.onMessage({ id: 41, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', itemId: 'cmd', command: 'pwd' } })
    expect(view.requests).toHaveLength(1)
    run.respond('41', { kind: 'permission', optionId: 'acceptForSession' })
    expect(client.reply).toHaveBeenCalledWith(41, { decision: 'acceptForSession' })
    expect(view.requests).toHaveLength(0)
    client.onMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } })
    await tick()
    expect(mocks.call.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(2)
    client.onMessage({ id: 42, method: 'item/fileChange/requestApproval', params: { threadId: 'thread' } })
    client.onError(new Error('crashed'))
    expect(view.status).toBe('errored')
    expect(view.requests).toHaveLength(0)
    const oldView = view
    client.onMessage({ method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'late' } })
    expect(view).toBe(oldView)
  })

  it('interrupts the active turn and drops queued input', async () => {
    mocks.call.mockImplementation(async (method: string) => method === 'turn/start' ? { turn: { id: 'turn' } } : {})
    const run = codexAdapter.start({ cwd: '/project', agentSessionId: 'thread', settings: {} }, () => {})
    run.send({ text: 'Hello', images: [] }); await tick()
    run.send({ text: 'queued', images: [] })
    await run.interrupt()
    expect(mocks.call).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread', turnId: 'turn' })
    mocks.clients[0].onMessage({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'interrupted' } } })
    await tick()
    expect(mocks.call.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1)
    run.close()
  })

  it('keeps unknown items visible', () => {
    expect(codexItem({ type: 'futureItem', id: 'future' } as unknown as ThreadItem)).toMatchObject({ kind: 'unknown', label: 'futureItem' })
  })
})
