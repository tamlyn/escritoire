import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionPointer } from '../shared/agent'
import type { AppState, Events, Project } from '../shared/api'
import type { ScreenSize } from '../shared/screen'
import type { SendEvent } from './api-server'
import { type Client, Clients, type ScreenHost } from './clients'

type Received = { name: keyof Events; payload: unknown }[]

let lastActive: string | null
let visible: Map<string, boolean>
let closedViews: string[]
let watched: string[]
let clients: Clients

beforeEach(() => {
  lastActive = 'a'
  visible = new Map()
  closedViews = []
  watched = []
  clients = new Clients({
    lastActiveProject: () => lastActive,
    setSessionVisible: (session, isVisible) => visible.set(session.agentSessionId, isVisible),
    closeSessionView: (session) => closedViews.push(session.agentSessionId),
    watch: (projectIds) => { watched = projectIds },
  })
})

function connect(desktop = true): { client: Client; received: Received } {
  const received: Received = []
  const send: SendEvent = (name, payload) => received.push({ name, payload })
  return { client: clients.connect(send, { desktop }), received }
}

const project = (id: string, isOpen = true): Project => ({ id, path: `/${id}`, name: id, isOpen, lastActiveAt: 0 })
const app = (activeProjectId: string | null, ...projects: Project[]): AppState => ({ projects, activeProjectId })

describe('projects', () => {
  it('gives each client its own active project, watching all of them', () => {
    const desktop = connect()
    const phone = connect(false)

    clients.activate(phone.client, app('b', project('a'), project('b')))

    expect(clients.state(desktop.client, app('b')).activeProjectId).toBe('a')
    expect(clients.state(phone.client, app('b')).activeProjectId).toBe('b')
    expect(watched.sort()).toEqual(['a', 'b'])
    // The desktop hears that the projects changed, but stays where it was.
    expect(desktop.received).toEqual([{ name: 'stateChanged', payload: app('a', project('a'), project('b')) }])
    expect(phone.received).toEqual([])

    clients.disconnect(phone.client)
    expect(watched).toEqual(['a'])
  })

  it('moves clients off a project that closes', () => {
    const desktop = connect()
    const phone = connect(false)

    const state = clients.projectsChanged(app('b', project('a', false), project('b')), phone.client)

    expect(state.activeProjectId).toBe('b')
    expect(clients.state(desktop.client, state).activeProjectId).toBe('b')
    expect(desktop.received.at(-1)).toMatchObject({ name: 'stateChanged', payload: { activeProjectId: 'b' } })
  })
})

describe('sessions', () => {
  const pointer: SessionPointer = { agent: 'claude', agentSessionId: 's1' }
  const event: Events['sessionEvent'] = { agentSessionId: 's1', seq: 1, event: { type: 'tasksChanged', tasks: [] } }

  it('sends session events only to clients with the session open', () => {
    const desktop = connect()
    const phone = connect(false)
    clients.openSessionView(phone.client, pointer)

    clients.send('sessionEvent', event)
    clients.send('sessionsChanged', [])

    expect(phone.received.map((r) => r.name)).toEqual(['sessionEvent', 'sessionsChanged'])
    expect(desktop.received.map((r) => r.name)).toEqual(['sessionsChanged'])
  })

  it('counts a session visible while any present client shows it', () => {
    const desktop = connect()
    const phone = connect(false)
    clients.openSessionView(desktop.client, pointer)
    clients.openSessionView(phone.client, pointer)

    clients.setSessionVisible(desktop.client, pointer, true)
    expect(visible.get('s1')).toBe(true)

    clients.setDesktopPresent(false)
    expect(visible.get('s1')).toBe(false)

    clients.setSessionVisible(phone.client, pointer, true)
    expect(visible.get('s1')).toBe(true)

    clients.closeSessionView(phone.client, pointer)
    expect(visible.get('s1')).toBe(false)
    expect(closedViews).toEqual([])

    clients.setDesktopPresent(true)
    expect(visible.get('s1')).toBe(true)
  })

  it('closes the view once no client has it open, including by disconnecting', () => {
    const desktop = connect()
    const phone = connect(false)
    clients.openSessionView(desktop.client, pointer)
    clients.openSessionView(phone.client, pointer)

    clients.closeSessionView(desktop.client, pointer)
    expect(closedViews).toEqual([])

    clients.disconnect(phone.client)
    expect(closedViews).toEqual(['s1'])
  })

  it('starts a desktop client absent while the user is away', () => {
    clients.setDesktopPresent(false)
    const desktop = connect()
    clients.openSessionView(desktop.client, pointer)

    clients.setSessionVisible(desktop.client, pointer, true)

    expect(visible.get('s1')).toBe(false)
  })
})

describe('screens', () => {
  let calls: string[]
  let host: ScreenHost
  const desktopSize: ScreenSize = { cols: 120, rows: 40 }
  const phoneSize: ScreenSize = { cols: 40, rows: 20 }

  beforeEach(() => {
    calls = []
    host = {
      attach: async (_projectId, screenId, size) => {
        calls.push(`attach ${screenId} ${size.cols}`)
        return { data: '', seq: 0 }
      },
      detach: (screenId) => calls.push(`detach ${screenId}`),
      write: (_projectId, screenId, data) => calls.push(`write ${screenId} ${data}`),
      resize: (_projectId, screenId, size) => calls.push(`resize ${screenId} ${size.cols}`),
    }
  })

  it("keeps the desktop's size when a phone attaches, until the phone types", async () => {
    const desktop = connect()
    const phone = connect(false)
    await clients.attachScreen(desktop.client, host, 'a', 't1', desktopSize)
    await clients.attachScreen(phone.client, host, 'a', 't1', phoneSize)

    clients.writeScreen(phone.client, 't1', 'ls')
    clients.writeScreen(phone.client, 't1', '\r')
    clients.writeScreen(desktop.client, 't1', 'pwd')

    expect(calls).toEqual([
      'attach t1 120',
      'attach t1 120',
      'resize t1 40',
      'write t1 ls',
      'write t1 \r',
      'resize t1 120',
      'write t1 pwd',
    ])
  })

  it('sends output only to attached clients, and detaches once none are', async () => {
    const desktop = connect()
    const phone = connect(false)
    await clients.attachScreen(desktop.client, host, 'a', 't1', desktopSize)
    await clients.attachScreen(phone.client, host, 'a', 't1', phoneSize)

    clients.detachScreen(desktop.client, 't1')
    clients.send('screenOutput', { screenId: 't1', data: 'x', seq: 1 })
    clients.disconnect(phone.client)

    expect(desktop.received).toEqual([])
    expect(phone.received.map((r) => r.name)).toEqual(['screenOutput'])
    expect(calls.at(-1)).toBe('detach t1')
  })

  it('ignores input from a client not attached to the screen', async () => {
    const desktop = connect()
    const phone = connect(false)
    await clients.attachScreen(desktop.client, host, 'a', 't1', desktopSize)

    clients.writeScreen(phone.client, 't1', 'ls')
    clients.resizeScreen(phone.client, 't1', phoneSize)

    expect(calls).toEqual(['attach t1 120'])
  })
})
