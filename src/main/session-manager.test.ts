import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, Item, SessionSettings, UserInput } from '../shared/agent'
import type { AgentAdapter, StartOptions } from './agents/types'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'

function fakeAdapter(history: Item[] = []) {
  const runs: {
    options: StartOptions
    emit: (e: AgentEvent) => void
    sent: string[]
    settings: SessionSettings[]
    refuseSettings: boolean
    usageRefreshes: number
  }[] = []
  let created = 0
  const adapter: AgentAdapter = {
    kind: 'claude',
    createSession: async () => `session-${++created}`,
    forkSession: async () => 'fork-1',
    listSessions: async () => [],
    loadHistory: async () => ({ items: history }),
    settingChoices: async () => ({ models: [], permissionModes: [] }),
    listCommands: async () => [],
    start(options, emit) {
      const run = { options, emit, sent: [] as string[], settings: [] as SessionSettings[], refuseSettings: false, usageRefreshes: 0 }
      runs.push(run)
      return {
        send: (input) => {
          run.sent.push(input.text)
          emit({ type: 'statusChanged', status: 'working' })
        },
        interrupt: async () => {},
        respond: () => {},
        changeSettings: async (settings) => {
          if (run.refuseSettings) throw new Error('Not available')
          run.settings.push(settings)
        },
        stopTask: async () => {},
        refreshUsage: async () => { run.usageRefreshes++ },
        close: () => {},
      }
    },
  }
  return { adapter, runs }
}

const say = (text: string): UserInput => ({ text, images: [] })

async function setup(history: Item[] = [], now?: () => number) {
  const dataDir = await mkdtemp(join(tmpdir(), 'escritoire-sessions-'))
  const { adapter, runs } = fakeAdapter(history)
  const sent: { name: string; payload: unknown }[] = []
  let time = 1000
  const manager = new SessionManager({
    adapters: { claude: adapter },
    store: new SessionStore(dataDir),
    projectPath: () => '/work/project',
    send: (name, payload) => sent.push({ name, payload }),
    now: now ?? (() => time++),
  })
  return { manager, runs, sent, dataDir }
}

afterEach(() => { vi.useRealTimers() })

describe('SessionManager', () => {
  it('starts a new session fresh, titled from its first message', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Fix the login bug\nIt fails on Safari'))

    expect(runs[0]!.options).toEqual({ cwd: '/work/project', agentSessionId: 'session-1', settings: {} })
    expect(manager.summaries()).toEqual([
      { ...pointer, projectId: 'p1', title: 'Fix the login bug', status: 'working', attention: null },
    ])
  })

  it('rewarms with a minimal turn, keeping the draft and rejecting a second request while busy', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    manager.saveDraft(pointer, 'My next question')

    manager.rewarm(pointer)
    expect(runs[0]!.sent.at(-1)).toBe('Rewarm the prompt cache. Reply only with "Ready". Do not use tools or take any other action.')
    expect((await manager.openSession('p1', pointer)).draft).toBe('My next question')
    expect(() => manager.rewarm(pointer)).toThrow('Finish the current turn')
    expect(runs[0]!.sent).toHaveLength(2)
    manager.closeSession(pointer)
  })

  it('keeps the title of a session started elsewhere', async () => {
    const { manager, runs } = await setup([{ kind: 'userMessage', id: 'u1', text: 'Earlier' }])
    const pointer = { agent: 'claude' as const, agentSessionId: 'external' }
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Carry on'))

    expect(opened.view.items).toHaveLength(1)
    expect(runs).toHaveLength(1)
    expect(manager.summaries()[0]!.title).toBe('')
  })

  it('takes the title the agent gives the session', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Fix the login bug'))
    runs[0]!.emit({ type: 'titleChanged', title: 'Safari login fix' })

    expect(manager.summaries()[0]!.title).toBe('Safari login fix')
    await manager.closeProject('p1')
    expect((await new SessionStore(dataDir).get('p1', 'session-1'))?.title).toBe('Safari login fix')
  })

  it('forwards events with increasing sequence numbers', async () => {
    const { manager, runs, sent } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })

    const events = sent.filter((s) => s.name === 'sessionEvent').map((s) => s.payload)
    expect(events).toEqual([
      { agentSessionId: 'session-1', seq: opened.seq + 1, event: { type: 'statusChanged', status: 'working' } },
      { agentSessionId: 'session-1', seq: opened.seq + 2, event: { type: 'statusChanged', status: 'idle' } },
    ])
  })

  it('continues the run as the new session when the agent resets the conversation', async () => {
    const { manager, runs, sent, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Remember 789'))
    runs[0]!.emit({ type: 'conversationReset', agentSessionId: 'session-2' })

    expect(sent.at(-2)!.payload).toMatchObject({ agentSessionId: 'session-1', event: { type: 'conversationReset' } })
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    const moved = { agent: 'claude' as const, agentSessionId: 'session-2' }
    expect((await manager.openSession('p1', moved)).view.items).toEqual([])
    manager.sendMessage(moved, say('What number?'))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.sent).toEqual(['Remember 789', 'What number?'])
    expect(manager.summaries().map((s) => [s.agentSessionId, s.title])).toEqual([['session-2', 'What number?']])
    // A client that missed the reset is sent on to the new session.
    expect(await manager.openSession('p1', pointer)).toMatchObject({ movedTo: 'session-2' })
    // Closing the old tab leaves the run alone.
    manager.closeSession(pointer)
    expect(manager.summaries()).toHaveLength(1)

    await manager.closeProject('p1')
    const store = new SessionStore(dataDir)
    expect((await store.get('p1', 'session-1'))?.title).toBe('Remember 789')
    expect((await store.get('p1', 'session-2'))?.title).toBe('What number?')
  })

  it('answers with the last command list while it fetches a newer one', async () => {
    const { adapter } = fakeAdapter()
    const lists = [[{ name: 'one', description: '' }], [{ name: 'two', description: '' }]]
    let calls = 0
    adapter.listCommands = async () => lists[Math.min(calls++, 1)]!
    const manager = new SessionManager({ adapters: { claude: adapter }, store: new SessionStore(await mkdtemp(join(tmpdir(), 'escritoire-sessions-'))), projectPath: () => '/work/project', send: () => {} })

    expect(await manager.listCommands('p1', 'claude')).toEqual(lists[0])
    await Promise.resolve()
    expect(await manager.listCommands('p1', 'claude')).toEqual(lists[0])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await manager.listCommands('p1', 'claude')).toEqual(lists[1])
  })

  it('marks a finished turn unread until the session is seen', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    expect(manager.summaries()[0]!.attention).toBe('unread')

    manager.setVisible(pointer, true)
    expect(manager.summaries()[0]!.attention).toBe(null)
  })

  it('reports a pending request as waiting', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'requestAdded', request: { kind: 'question', id: 'r1', questions: [] } })
    expect(manager.summaries()[0]!.attention).toBe('waiting')
  })

  it('starts a new run after one fails', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'errored', error: 'Claude Code exited.' })
    manager.sendMessage(pointer, say('Again'))

    expect(runs).toHaveLength(2)
    expect(runs[1]!.sent).toEqual(['Again'])
  })

  it('remembers drafts and read state across restarts', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    manager.saveDraft(pointer, 'Next, ')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const restarted = new SessionManager({
      adapters: { claude: fakeAdapter().adapter },
      store: new SessionStore(dataDir),
      projectPath: () => '/work/project',
      send: () => {},
    })
    const reopened = await restarted.openSession('p1', pointer)
    expect(reopened).toMatchObject({ title: 'Hi', draft: 'Next, ' })
    expect(restarted.summaries()[0]!.attention).toBe('unread')
  })

  it('lists sessions left unread before a restart until they load', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    await manager.closeProject('p1')

    const sent: unknown[] = []
    const restarted = new SessionManager({
      adapters: { claude: fakeAdapter().adapter },
      store: new SessionStore(dataDir),
      projectPath: () => '/work/project',
      send: (_name, payload) => sent.push(payload),
    })
    await restarted.restoreUnread('p1', new Set([pointer.agentSessionId]))
    const unread = { ...pointer, projectId: 'p1', title: 'Hi', status: 'idle', attention: 'unread' }
    expect(restarted.summaries()).toEqual([unread])
    expect(sent).toEqual([[unread]])

    await restarted.openSession('p1', pointer)
    expect(restarted.summaries()).toEqual([unread])
  })

  it('keeps a closed project’s unread sessions listed', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })

    await manager.closeProject('p1')

    expect(manager.summaries()).toEqual([{ ...pointer, projectId: 'p1', title: 'Hi', status: 'idle', attention: 'unread' }])
  })

  it('forgets a removed project’s unread sessions and records', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })

    await manager.removeProject('p1')

    expect(manager.summaries()).toEqual([])
    expect(await new SessionStore(dataDir).list('p1')).toEqual({})
  })

  it('marks a session seen when its tab closes, loaded or not', async () => {
    const { manager, runs, dataDir } = await setup()
    const first = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', first)
    manager.sendMessage(first, say('One'))
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    manager.closeSession(first)
    await manager.closeProject('p1')
    const store = new SessionStore(dataDir)
    const record = (await store.get('p1', first.agentSessionId))!
    expect(record.lastSeenAt).toBeGreaterThanOrEqual(record.lastTurnEndedAt)

    // Unread when the project closed, so restored, then closed without loading.
    await store.put('p1', 'session-2', { ...record, title: 'Two', lastSeenAt: 0 })
    const restarted = new SessionManager({
      adapters: { claude: fakeAdapter().adapter },
      store: new SessionStore(dataDir),
      projectPath: () => '/work/project',
      send: () => {},
    })
    await restarted.restoreUnread('p1', new Set(['session-2']))
    expect(restarted.summaries().map((s) => s.title)).toEqual(['Two'])
    restarted.closeSession({ agent: 'claude', agentSessionId: 'session-2' })
    expect(restarted.summaries()).toEqual([])
    await restarted.closeProject('p1')
    const second = (await new SessionStore(dataDir).get('p1', 'session-2'))!
    expect(second.lastSeenAt).toBeGreaterThanOrEqual(second.lastTurnEndedAt)
  })

  it('restores only the unread sessions that still have a tab', async () => {
    const { dataDir } = await setup()
    const store = new SessionStore(dataDir)
    const record = { agent: 'claude' as const, title: 'Open', draft: '', lastSeenAt: 0, lastTurnEndedAt: 5 }
    await store.put('p1', 'open', record)
    await store.put('p1', 'dismissed', { ...record, title: 'Dismissed' })
    const restarted = new SessionManager({ adapters: { claude: fakeAdapter().adapter }, store, projectPath: () => '/work/project', send: () => {} })

    await restarted.restoreUnread('p1', new Set(['open']))

    expect(restarted.summaries().map((s) => s.title)).toEqual(['Open'])
  })

  it('closes a session whose tab closed while it was loading', async () => {
    const { dataDir } = await setup()
    const store = new SessionStore(dataDir)
    await store.put('p1', 's1', { agent: 'claude', title: 'Unread', draft: '', lastSeenAt: 0, lastTurnEndedAt: 5 })
    const { adapter } = fakeAdapter()
    let finishLoading = () => {}
    adapter.loadHistory = () => new Promise((resolve) => { finishLoading = () => resolve({ items: [] }) })
    const manager = new SessionManager({ adapters: { claude: adapter }, store, projectPath: () => '/work/project', send: () => {}, now: () => 100 })
    const pointer = { agent: 'claude' as const, agentSessionId: 's1' }
    await manager.restoreUnread('p1', new Set(['s1']))

    const opening = manager.openSession('p1', pointer)
    await new Promise((resolve) => setTimeout(resolve, 10))
    manager.closeSession(pointer)
    finishLoading()
    await opening
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(manager.summaries()).toEqual([])
    await manager.closeProject('p1')
    expect((await store.get('p1', 's1'))!.lastSeenAt).toBe(100)
  })

  it('holds a queued message while it is edited, and whatever is sent after it', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('First'))
    manager.sendMessage(pointer, say('Secnod'))
    const { view } = await manager.openSession('p1', pointer)
    const id = view.queued[0]!.id

    manager.setQueuedMessageHeld(pointer, id, true)
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    manager.sendMessage(pointer, say('Third'))
    expect(runs[0]!.sent).toEqual(['First'])

    manager.editQueuedMessage(pointer, id, 'Second')
    manager.setQueuedMessageHeld(pointer, id, false)
    expect(runs[0]!.sent).toEqual(['First', 'Second'])
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    expect(runs[0]!.sent).toEqual(['First', 'Second', 'Third'])
  })

  it('sends an edited message in a fork of the session, which clients follow', async () => {
    const image = { mediaType: 'image/png', data: 'AA==' }
    const { manager, runs, sent, dataDir } = await setup([
      { kind: 'userMessage', id: 'u1', text: 'Fix the bug' },
      { kind: 'agentMessage', id: 'a1', text: 'Fixed' },
      { kind: 'userMessage', id: 'u2', text: 'Add a tset', images: [image] },
    ])
    const pointer = { agent: 'claude' as const, agentSessionId: 'original' }
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hello'))
    runs[0]!.emit({ type: 'titleChanged', title: 'Bug fix' })
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })

    await manager.editMessage(pointer, 'u2', 'Add a test')

    expect(runs[1]!.options.agentSessionId).toBe('fork-1')
    expect(manager.summaries()).toEqual([
      { agent: 'claude', agentSessionId: 'fork-1', projectId: 'p1', title: 'Bug fix', status: 'working', attention: null },
    ])
    const follow = sent.filter((s) => s.name === 'sessionEvent').at(-1)!.payload
    expect(follow).toEqual({ agentSessionId: 'original', seq: opened.seq + 4, event: { type: 'conversationReset', agentSessionId: 'fork-1' } })
    const fork = await manager.openSession('p1', { agent: 'claude', agentSessionId: 'fork-1' })
    expect(fork.movedTo).toBeNull()
    expect(runs[1]!.sent).toEqual(['Add a test'])
    await manager.closeProject('p1')
    expect((await new SessionStore(dataDir).get('p1', 'original'))?.title).toBe('Bug fix')
  })

  it("won't edit a message during a turn", async () => {
    const { manager } = await setup([{ kind: 'userMessage', id: 'u1', text: 'Fix the bug' }])
    const pointer = { agent: 'claude' as const, agentSessionId: 'original' }
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hello'))

    await expect(manager.editMessage(pointer, 'u1', 'Fix it')).rejects.toThrow('Stop the agent')
  })

  it('holds a scheduled message until its time, and what is sent meanwhile behind it', async () => {
    vi.useFakeTimers({ now: 0 })
    const { manager, runs } = await setup([], Date.now)
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.scheduleMessage(pointer, say('continue'), 150_000)
    manager.sendMessage(pointer, say('And then'))
    expect(runs).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runs[0]!.sent).toEqual(['continue'])
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    expect(runs[0]!.sent).toEqual(['continue', 'And then'])
  })

  it('sends what waited behind a scheduled message once that is cancelled', async () => {
    vi.useFakeTimers({ now: 0 })
    const { manager, runs } = await setup([], Date.now)
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.scheduleMessage(pointer, say('continue'), 150_000)
    manager.sendMessage(pointer, say('Now'))
    const { view } = await manager.openSession('p1', pointer)

    manager.cancelQueuedMessage(pointer, view.queued[0]!.id)
    expect(runs[0]!.sent).toEqual(['Now'])
  })

  it('starts runs with the chosen settings and changes the running one', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    await manager.changeSettings(pointer, { model: 'opus', permissionMode: 'plan' })
    manager.sendMessage(pointer, say('Hi'))
    await manager.changeSettings(pointer, { model: null })

    expect(runs[0]!.options.settings).toEqual({ model: 'opus', permissionMode: 'plan' })
    expect(runs[0]!.settings).toEqual([{ model: null }])

    await new Promise((resolve) => setTimeout(resolve, 50))
    const restarted = new SessionManager({
      adapters: { claude: fakeAdapter().adapter },
      store: new SessionStore(dataDir),
      projectPath: () => '/work/project',
      send: () => {},
    })
    const reopened = await restarted.openSession('p1', pointer)
    expect(reopened.view.settings).toEqual({ model: null, permissionMode: 'plan' })
  })

  it('starts new sessions with the model and effort last chosen for future sessions too', async () => {
    const { manager, runs } = await setup()
    const first = await manager.createSession('p1', 'claude')
    const older = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', first)
    await manager.changeSettings(first, { model: 'opus', effort: 'high', permissionMode: 'plan' }, true)
    await manager.changeSettings(first, { model: 'haiku', effort: 'low' })

    const next = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', next)
    manager.sendMessage(next, say('Hi'))
    // A session saved before efforts were always chosen keeps its model.
    await manager.openSession('p1', older)
    manager.sendMessage(older, say('Hi'))

    expect(runs.map((run) => run.options.settings)).toEqual([{ model: 'opus', effort: 'high' }, { effort: 'high' }])
  })

  it('starts the run to refresh usage, and keeps it for the next message', async () => {
    const { manager, runs } = await setup([{ kind: 'userMessage', id: 'u1', text: 'Earlier' }])
    const pointer = { agent: 'claude' as const, agentSessionId: 'external' }
    await manager.openSession('p1', pointer)
    await manager.refreshUsage(pointer)
    await manager.refreshUsage(pointer)
    manager.sendMessage(pointer, say('Carry on'))

    expect(runs).toHaveLength(1)
    expect(runs[0]!.usageRefreshes).toBe(2)
    expect(runs[0]!.sent).toEqual(['Carry on'])
  })

  it('forgets a setting the run refuses', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    runs[0]!.refuseSettings = true
    await manager.changeSettings(pointer, { permissionMode: 'auto' })

    const { view } = await manager.openSession('p1', pointer)
    expect(view.settings).toEqual({})
    expect(view.items).toContainEqual(expect.objectContaining({ kind: 'notice', level: 'error' }))

    runs[0]!.emit({ type: 'statusChanged', status: 'errored', error: 'Claude Code exited.' })
    manager.sendMessage(pointer, say('Again'))
    expect(runs[1]!.options.settings).toEqual({})
  })

  it('queues messages sent during a turn and sends them one per turn', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('First'))
    manager.sendMessage(pointer, say('Second'))
    manager.sendMessage(pointer, say('Third'))
    manager.sendMessage(pointer, say('Fourth'))

    const queued = () => manager.openSession('p1', pointer).then(({ view }) => view.queued)
    const [second, third, fourth] = await queued()
    expect(runs[0]!.sent).toEqual(['First'])
    manager.editQueuedMessage(pointer, second!.id, 'Second, edited')
    manager.cancelQueuedMessage(pointer, third!.id)

    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    expect(runs[0]!.sent).toEqual(['First', 'Second, edited'])
    expect(await queued()).toEqual([fourth])

    // An interrupted or failed turn ends too.
    runs[0]!.emit({ type: 'statusChanged', status: 'errored', error: 'Claude Code exited.' })
    expect(runs[1]!.sent).toEqual(['Fourth'])
    expect(await queued()).toEqual([])
  })

  it('continues in the mode the agent switched to', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    await manager.changeSettings(pointer, { permissionMode: 'plan' })
    manager.sendMessage(pointer, say('Plan it'))
    runs[0]!.emit({ type: 'settingsChanged', settings: { permissionMode: 'acceptEdits' } })
    runs[0]!.emit({ type: 'statusChanged', status: 'errored', error: 'Claude Code exited.' })
    manager.sendMessage(pointer, say('Go on'))

    expect(runs[1]!.options.settings).toEqual({ permissionMode: 'acceptEdits' })
  })
})

it('does not insert a session whose project closed during history loading', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'escritoire-cancel-'))
  const { adapter } = fakeAdapter()
  let finish!: () => void
  let started!: () => void
  const loading = new Promise<void>((resolve) => { started = resolve })
  adapter.loadHistory = async () => {
    started()
    await new Promise<void>((resolve) => { finish = resolve })
    return { items: [] }
  }
  const manager = new SessionManager({ adapters: { claude: adapter }, store: new SessionStore(dataDir), projectPath: () => '/work', send: () => {} })
  const opened = manager.openSession('p', { agent: 'claude', agentSessionId: 'late' })
  const rejected = expect(opened).rejects.toThrow('Closed')
  await loading
  const closing = manager.closeProject('p')
  finish()
  await rejected
  await closing
  expect(manager.summaries()).toEqual([])
})
