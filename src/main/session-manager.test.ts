import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, Item } from '../shared/agent'
import type { AgentAdapter, StartOptions } from './agents/types'
import { SessionManager } from './session-manager'
import { SessionStore } from './session-store'

function fakeAdapter(history: Item[] = []) {
  const runs: { options: StartOptions; emit: (e: AgentEvent) => void; sent: string[] }[] = []
  const adapter: AgentAdapter = {
    kind: 'claude',
    createSession: async () => 'session-1',
    listSessions: async () => [],
    loadHistory: async () => history,
    start(options, emit) {
      const run = { options, emit, sent: [] as string[] }
      runs.push(run)
      return {
        send: (text) => {
          run.sent.push(text)
          emit({ type: 'statusChanged', status: 'working' })
        },
        interrupt: async () => {},
        respond: () => {},
        close: () => {},
      }
    },
  }
  return { adapter, runs }
}

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
    manager.sendMessage(pointer, 'Fix the login bug\nIt fails on Safari')

    expect(runs[0]!.options).toEqual({ cwd: '/work/project', agentSessionId: 'session-1' })
    expect(manager.summaries()).toEqual([
      { ...pointer, projectId: 'p1', title: 'Fix the login bug', status: 'working', attention: null },
    ])
  })

  it('keeps the title of a session started elsewhere', async () => {
    const { manager, runs } = await setup([{ kind: 'userMessage', id: 'u1', text: 'Earlier' }])
    const pointer = { agent: 'claude' as const, agentSessionId: 'external' }
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, 'Carry on')

    expect(opened.view.items).toHaveLength(1)
    expect(runs).toHaveLength(1)
    expect(manager.summaries()[0]!.title).toBe('')
  })

  it('forwards events with increasing sequence numbers only while subscribed', async () => {
    const { manager, runs, sent } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    const opened = await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, 'Hi')
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
    manager.sendMessage(pointer, 'Hi')
    runs[0]!.emit({ type: 'statusChanged', status: 'idle' })
    expect(manager.summaries()[0]!.attention).toBe('unread')

    manager.setVisible(pointer, true)
    expect(manager.summaries()[0]!.attention).toBe(null)
  })

  it('reports a pending request as waiting', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, 'Hi')
    runs[0]!.emit({ type: 'requestAdded', request: { kind: 'question', id: 'r1', questions: [] } })
    expect(manager.summaries()[0]!.attention).toBe('waiting')
  })

  it('starts a new run after one fails', async () => {
    const { manager, runs } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, 'Hi')
    runs[0]!.emit({ type: 'statusChanged', status: 'errored', error: 'Claude Code exited.' })
    manager.sendMessage(pointer, 'Again')

    expect(runs).toHaveLength(2)
    expect(runs[1]!.sent).toEqual(['Again'])
  })

  it('remembers drafts and read state across restarts', async () => {
    const { manager, runs, dataDir } = await setup()
    const pointer = await manager.createSession('p1', 'claude')
    await manager.openSession('p1', pointer)
    manager.sendMessage(pointer, 'Hi')
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
})
