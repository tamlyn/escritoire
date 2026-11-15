import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WebSocket as WsClient } from 'ws'
import type { ProcessInfo } from '../shared/process'
import { type ApiClient, connectApi } from '../shared/api-client'
import { ApiServer, type SendEvent, tokensMatch } from './api-server'

const token = 'secret'
let server: ApiServer
let handled: { method: string; args: unknown[] }[]
type Connected = { send: SendEvent; closed: boolean }
let connected: Connected[]
const clients: ApiClient[] = []

beforeEach(async () => {
  handled = []
  // Each test's own, as connections from the last test can still be closing.
  const connections: Connected[] = (connected = [])
  server = await ApiServer.start({
    port: 0,
    admits: (request) => request.headers.origin === undefined || request.headers.origin === 'file://',
    connect: (given, send) => {
      if (!tokensMatch(given, token)) return undefined
      const connection = { send, closed: false }
      connections.push(connection)
      return {
        handle: async (method, args) => {
          handled.push({ method, args })
          if (method === 'readFile') throw new Error('No such file')
          if (method === 'getState') return { projects: [], activeProjectId: null }
          if (method === 'interrupt') return new Promise(() => {})
          return undefined
        },
        close: () => { connection.closed = true },
      }
    },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await server.close()
  vi.restoreAllMocks()
})

function connect(given = token): ApiClient {
  const client = connectApi(Promise.resolve({ url: server.url, token: given }))
  clients.push(client)
  return client
}

const pointer = { agent: 'claude', agentSessionId: 's1' } as const

test('replies to calls with their results or errors', async () => {
  const { api } = connect()

  await expect(api.getState()).resolves.toEqual({ projects: [], activeProjectId: null })
  await expect(api.closeSessionView(pointer)).resolves.toBeUndefined()
  await expect(api.readFile('p', 'missing.txt')).rejects.toThrow(/^No such file$/)
})

test('keeps arguments as they were given', async () => {
  const { api } = connect()

  await api.writeFile('p', 'a.txt', 'text', undefined)
  await api.changeSessionSettings(pointer, { model: null, effort: 'high' })

  expect(handled).toEqual([
    // JSON would turn the undefined into null.
    { method: 'writeFile', args: ['p', 'a.txt', 'text'] },
    { method: 'changeSessionSettings', args: [pointer, { model: null, effort: 'high' }] },
  ])
})

test('sends each client its own events', async () => {
  const first = connect()
  const second = connect()
  const received: string[] = []
  first.subscribe('processesChanged', () => received.push('first'))
  second.subscribe('processesChanged', () => received.push('second'))
  await first.api.listProcesses()
  await second.api.listProcesses()

  connected[1]!.send('processesChanged', [] as ProcessInfo[])
  await first.api.listProcesses()
  await second.api.listProcesses()

  expect(received).toEqual(['second'])
})

test('closes a connection when its client disconnects', async () => {
  const client = connect()
  await client.api.listProcesses()

  client.close()
  await vi.waitFor(() => expect(connected[0]!.closed).toBe(true))
})

test('refuses a client with the wrong token', async () => {
  const { api } = connect('wrong')

  await expect(api.getState()).rejects.toThrow('Not authorised')
  expect(handled).toEqual([])
})

test('refuses pages from other origins', async () => {
  const status = (origin: string) => new Promise((resolve) => {
    const socket = new WsClient(server.url, { origin })
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode))
    socket.on('open', () => {
      socket.close()
      resolve('open')
    })
  })

  expect(await status('https://example.com')).toBe(403)
  expect(await status('file://')).toBe('open')
})

test('fails calls in flight when the connection closes', async () => {
  const { api } = connect()
  await api.getState()

  const interrupted = api.interrupt(pointer)
  await server.close()

  await expect(interrupted).rejects.toThrow()
  await expect(api.getState()).rejects.toThrow()
})
