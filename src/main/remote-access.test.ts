import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { type ApiClient, connectApi, notAuthorized } from '../shared/api-client'
import type { RemoteAccess as RemoteAccessState } from '../shared/remote'
import { RemoteAccess } from './remote-access'

let dataDir: string
let rendererDir: string
let remote: RemoteAccess
let changes: RemoteAccessState[]
const clients: ApiClient[] = []

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'escritoire-remote-'))
  rendererDir = join(dataDir, 'renderer')
  await mkdir(join(rendererDir, 'assets'), { recursive: true })
  await writeFile(join(rendererDir, 'index.html'), '<!doctype html>')
  await writeFile(join(rendererDir, 'assets', 'index-abc.js'), 'console.log(1)')
  await writeFile(join(dataDir, 'secret.txt'), 'secret')
  changes = []
  remote = await load()
  await remote.configure({ enabled: true, port: await freePort() })
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await remote.close()
  await rm(dataDir, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

function load(): Promise<RemoteAccess> {
  return RemoteAccess.load({
    dataDir,
    rendererDir,
    connect: () => ({ handle: async (method) => `handled ${method}`, close: () => {} }),
    onChange: (state) => changes.push(state),
    tailscale: {
      state: async () => ({ available: true, url: null }),
      publish: async () => ({ available: true, url: 'https://mac.tailnet.ts.net' }),
    },
  })
}

type Response = { status: number; body: string; headers: Record<string, string | string[] | undefined> }

function request(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(`${remote.url}${path}`, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }))
    })
    sent.on('error', reject)
    sent.end(options.body)
  })
}

function pair(code: string, headers: Record<string, string> = {}): Promise<Response> {
  return request('/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ code, name: 'iPhone' }),
  })
}

function connect(token: string): ApiClient {
  const client = connectApi(Promise.resolve({ url: `${remote.url!.replace(/^http/, 'ws')}/api`, token }))
  clients.push(client)
  return client
}

test('serves the renderer, and nothing outside it', async () => {
  expect(await request('/')).toMatchObject({ status: 200, body: '<!doctype html>' })
  expect(await request('/assets/index-abc.js')).toMatchObject({
    status: 200,
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' },
  })
  expect((await request('/..%2fsecret.txt')).status).toBe(404)
  expect((await request('/missing.js')).status).toBe(404)
})

test('refuses other hosts, and pages from other origins', async () => {
  // A page whose DNS has been rebound to this machine.
  expect((await request('/', { headers: { Host: 'evil.example' } })).status).toBe(403)
  expect((await request('/', { headers: { Host: 'mac.tail1234.ts.net' } })).status).toBe(200)
  remote.startPairing()
  expect((await pair('000000', { Origin: 'https://evil.example' })).status).toBe(403)
  expect((await pair('000000', { Host: 'mac.tail1234.ts.net', Origin: 'https://mac.tail1234.ts.net' })).status).toBe(403)
  expect(JSON.parse((await pair('000000', { Host: 'mac.tail1234.ts.net', Origin: 'https://mac.tail1234.ts.net' })).body).error).toMatch(/isn't right/)
})

test('pairs a device with the code, keeping only a hash of its token', async () => {
  const { pairing } = remote.startPairing()

  const response = await pair(pairing!.code)
  const { token } = JSON.parse(response.body) as { token: string }

  expect(response.status).toBe(200)
  expect(remote.state()).toMatchObject({ pairing: null, devices: [{ name: 'iPhone', connected: false }] })
  expect(await readFile(join(dataDir, 'remote-access.json'), 'utf8')).not.toContain(token)
  // Single use.
  expect((await pair(pairing!.code)).status).toBe(403)

  const client = connect(token)
  await expect(client.api.getState()).resolves.toBe('handled getState')
  expect(remote.state().devices[0]!.connected).toBe(true)

  const restarted = await load()
  expect(restarted.state()).toMatchObject({ enabled: true, devices: [{ name: 'iPhone' }] })
})

test('gives up on a code after a few wrong attempts', async () => {
  const { pairing } = remote.startPairing()
  const wrong = pairing!.code === '000000' ? '111111' : '000000'

  for (let attempt = 1; attempt <= 5; attempt++) expect((await pair(wrong)).status).toBe(403)

  expect(remote.state().pairing).toBeNull()
  expect((await pair(pairing!.code)).status).toBe(403)
})

test('refuses unknown tokens, and disconnects a revoked device', async () => {
  await expect(connect('made-up').api.getState()).rejects.toThrow(notAuthorized)

  const { token } = JSON.parse((await pair(remote.startPairing().pairing!.code)).body) as { token: string }
  const client = connect(token)
  await client.api.getState()

  const revoked = remote.revoke(remote.state().devices[0]!.id)
  await revoked
  await expect(client.api.getState()).rejects.toThrow(notAuthorized)
  expect(remote.state().devices).toEqual([])
})

test('reports a port that is in use, and serves nothing while off', async () => {
  const blocker = createServer()
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const port = (blocker.address() as { port: number }).port

  const state = await remote.configure({ enabled: true, port })
  expect(state.error).toMatch(/EADDRINUSE/)
  expect(remote.url).toBeNull()
  blocker.close()

  await remote.configure({ enabled: false, port })
  expect(remote.url).toBeNull()
  expect(() => remote.startPairing()).toThrow('Turn on remote access first.')
  expect(changes.at(-1)).toMatchObject({ enabled: false, error: null })
})

test('ends the code after a few minutes', async () => {
  vi.useFakeTimers()
  try {
    remote.startPairing()
    vi.advanceTimersByTime(5 * 60_000)
    expect(remote.state().pairing).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('keeps a push subscription with its device until the device is revoked', async () => {
  const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }
  remote.startPairing()
  await pair(remote.state().pairing!.code)
  const [device] = remote.state().devices
  await remote.setPushSubscription(device!.id, subscription)

  expect(remote.pushTargets()).toEqual([{ deviceId: device!.id, subscription }])
  expect(JSON.stringify(remote.state())).not.toContain('push.example')

  // Paused while remote access is off, and back once it's on.
  const { port } = remote.state()
  await remote.configure({ enabled: false, port })
  expect(remote.pushTargets()).toEqual([])
  await remote.configure({ enabled: true, port })
  expect(remote.pushTargets()).toHaveLength(1)

  // A newer subscription isn't forgotten when an older one is withdrawn.
  await remote.forgetPushSubscription(device!.id, 'https://push.example/old')
  expect(remote.pushTargets()).toHaveLength(1)

  await remote.revoke(device!.id)
  expect(remote.pushTargets()).toEqual([])
  const reloaded = await load()
  expect(reloaded.pushTargets()).toEqual([])
})

test('publishes the listener through Tailscale once it is on', async () => {
  await vi.waitFor(() => expect(remote.state().tailscale.available).toBe(true))

  expect((await remote.publish()).tailscale.url).toBe('https://mac.tailnet.ts.net')

  await remote.configure({ enabled: false, port: remote.state().port })
  await expect(remote.publish()).rejects.toThrow('Turn on remote access first.')
})
