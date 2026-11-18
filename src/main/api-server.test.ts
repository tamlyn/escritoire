import type { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { type ClientOptions, WebSocket as WsClient } from 'ws'
import type { ProcessInfo } from '../shared/process'
import { type ApiClient, connectApi, notAuthorized } from '../shared/api-client'
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
    heartbeatMs: 50,
    connect: ({ token: given }, send) => {
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

function rawClient(options: ClientOptions = {}): Promise<WsClient> {
  return new Promise((resolve) => {
    const socket = new WsClient(server.url, options)
    socket.on('open', () => {
      socket.send(JSON.stringify({ token }))
      resolve(socket)
    })
  })
}

test('terminates a client that stops answering pings', async () => {
  await rawClient({ autoPong: false })

  await vi.waitFor(() => expect(connected[0]?.closed).toBe(true))
})

test('keeps a client that answers pings', async () => {
  const socket = await rawClient()
  await vi.waitFor(() => expect(connected).toHaveLength(1))

  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(connected[0]!.closed).toBe(false)
  socket.close()
})

test('terminates a client that stops reading once too much is waiting for it', async () => {
  const socket = await rawClient()
  await vi.waitFor(() => expect(connected).toHaveLength(1))
  ;(socket as unknown as { _socket: Socket })._socket.pause()

  const megabyte = 'x'.repeat(1024 * 1024)
  for (let sent = 0; sent < 200 && !connected[0]!.closed; sent++) {
    connected[0]!.send('processesChanged', megabyte as unknown as ProcessInfo[])
    await new Promise((resolve) => setImmediate(resolve))
  }

  await vi.waitFor(() => expect(connected[0]!.closed).toBe(true))
  socket.terminate()
})

describe('reconnecting', () => {
  let port: number
  const serve = () => ApiServer.start({
    port,
    admits: () => true,
    connect: ({ token: given, activeProjectId }) => given === token
      ? { handle: async () => activeProjectId, close: () => {} }
      : undefined,
  })

  beforeEach(async () => {
    await server.close()
    server = await ApiServer.start({ port: 0, admits: () => true, connect: () => undefined })
    port = Number(new URL(server.url).port)
    await server.close()
    server = await serve()
  })

  test('fails calls in flight, then serves later calls on a new connection', async () => {
    const onLost = vi.fn()
    const onReconnected = vi.fn()
    const client = connectApi(Promise.resolve({ url: server.url, token }), { onLost, onReconnected, activeProjectId: () => 'p' })
    clients.push(client)
    await client.api.getState()
    expect(onReconnected).not.toHaveBeenCalled()

    const inFlight = client.api.interrupt(pointer)
    const closing = server.close()
    await expect(inFlight).rejects.toThrow()
    await closing
    expect(onLost).toHaveBeenCalledOnce()

    const waiting = client.api.getState()
    server = await serve()

    await expect(waiting).resolves.toBe('p')
    expect(onReconnected).toHaveBeenCalledOnce()
  })

  test('stops retrying once main no longer knows the token', async () => {
    const onLost = vi.fn()
    const client = connectApi(Promise.resolve({ url: server.url, token: 'revoked' }), { onLost })
    clients.push(client)

    await expect(client.api.getState()).rejects.toThrow(notAuthorized)
    await expect(client.api.getState()).rejects.toThrow(notAuthorized)
    expect(onLost).toHaveBeenCalledOnce()
  })

  test('replaces a socket that stops answering when asked to check it', async () => {
    const onReconnected = vi.fn()
    const client = connectApi(Promise.resolve({ url: server.url, token }), { onReconnected })
    clients.push(client)
    await client.api.getState()
    await server.close()
    server = await ApiServer.start({
      port,
      admits: () => true,
      connect: () => ({ handle: () => new Promise(() => {}), close: () => {} }),
    })
    await vi.waitFor(() => expect(onReconnected).toHaveBeenCalledOnce(), { timeout: 5000 })

    client.checkConnection()

    await vi.waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(2), { timeout: 8000 })
  }, 15_000)
})
