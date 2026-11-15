import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  }[] = []
  const adapter: AgentAdapter = {
    kind: 'claude',
    createSession: async () => 'session-1',
    listSessions: async () => [],
    loadHistory: async () => ({ items: history }),
    settingChoices: async () => ({ models: [], permissionModes: [] }),
    start(options, emit) {
      const run = { options, emit, sent: [] as string[], settings: [] as SessionSettings[], refuseSettings: false }
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
        close: () => {},
      }
    },
  }
  return { adapter, runs }
}

const say = (text: string): UserInput => ({ text, images: [] })

async function setup(history: Item[] = []) {
  const dataDir = await mkdtemp(join(tmpdir(), 'escritoire-sessions-'))
  const { adapter, runs } = fakeAdapter(history)
  const sent: { name: string; payload: unknown }[] = []
  let time = 1000
  const manager = new SessionManager({
    adapters: { claude: adapter },
    store: new SessionStore(dataDir),
    projectPath: () => '/work/project',
    send: (name, payload) => sent.push({ name, payload }),
    now: () => time++,
  })
  return { manager, runs, sent, dataDir }
}

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

  it('keeps the title of a session started elsewhere', async () => {
    const { manager, runs } = await setup([{ kind: 'userMessage', id: 'u1', text: 'Earlier' }])
    const pointer = { agent: 'claude' as const, agentSessionId: 'external' }
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Carry on'))

    expect(opened.view.items).toHaveLength(1)
    expect(runs).toHaveLength(1)
    expect(manager.summaries()[0]!.title).toBe('')
  })

  it('forwards events with increasing sequence numbers only while subscribed', async () => {
    const { manager, runs, sent } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, say('Hi'))
    manager.closeSessionView(pointer)
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })

    const events = sent.filter((s) => s.name === 'sessionEvent').map((s) => s.payload)
    expect(events).toEqual([
      { agentSessionId: 'session-1', seq: opened.seq + 1, event: { type: 'statusChanged', status: 'working' } },
    ])
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

  it('starts runs with the chosen settings and changes the running one', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    await manager.changeSettings(pointer, { model: 'opus', permissionMode: 'plan' })
    manager.sendMessage(pointer, say('Hi'))
    await manager.changeSettings(pointer, { model: undefined })

    expect(runs[0]!.options.settings).toEqual({ model: 'opus', permissionMode: 'plan' })
    expect(runs[0]!.settings).toEqual([{ model: undefined }])

    await new Promise((resolve) => setTimeout(resolve, 50))
    const restarted = new SessionManager({
      adapters: { claude: fakeAdapter().adapter },
      store: new SessionStore(dataDir),
      projectPath: () => '/work/project',
      send: () => {},
    })
    const reopened = await restarted.openSession('p1', pointer)
    expect(reopened.view.settings).toEqual({ model: undefined, permissionMode: 'plan' })
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
