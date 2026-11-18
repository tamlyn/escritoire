import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { defaultRemotePort, type PairedDevice, pairPath, type PushSubscription, type PushTarget, type RemoteAccess as RemoteAccessState, type TailscaleState } from '../shared/remote'
import type { Hello } from '../shared/api-client'
import { ApiServer, type Connection, type SendEvent, tokensMatch } from './api-server'
import { readJson, writeJson } from './json-file'
import { serveFile } from './static-files'
import type { TailscaleCli } from './tailscale'

/** Only a hash of each token is kept, so reading the data directory yields nothing usable. */
type SavedDevice = Omit<PairedDevice, 'connected'> & { tokenHash: string; pushSubscription?: PushSubscription }
type Saved = { enabled: boolean; port: number; devices: SavedDevice[]; publishedPort?: number }

const pairingLifetimeMs = 5 * 60_000
const pairingAttempts = 5
const maxPairBodyBytes = 1024
const maxNameLength = 60

export type RemoteAccessOptions = {
  dataDir: string
  /** The renderer's built files, served to browsers. */
  rendererDir: string
  /** Serves a paired device's connection. */
  connect: (send: SendEvent, client: { deviceId: string; activeProjectId: string | null }) => Connection
  onChange: (state: RemoteAccessState) => void
  tailscale: Pick<TailscaleCli, 'state' | 'publish'>
}

/**
 * Escritoire from another device: a listener on a fixed loopback port, for
 * `tailscale serve` to publish, serving the renderer, pairing and the API to
 * paired browsers only. Off by default, when nothing listens.
 */
export class RemoteAccess {
  private server: ApiServer | null = null
  private error: string | null = null
  private pairing: { code: string; expiresAt: number; attemptsLeft: number; expiry: NodeJS.Timeout } | null = null
  /** How to disconnect each connected device's connections. */
  private readonly connected = new Map<string, Set<() => void>>()
  private readonly writes = new Set<Promise<void>>()
  private closed = false
  private tailscale: TailscaleState = { available: false, url: null }
  /** Only the latest Tailscale command's answer counts. */
  private tailscaleRun = 0

  private constructor(
    private readonly options: RemoteAccessOptions,
    private saved: Saved,
  ) {}

  static async load(options: RemoteAccessOptions): Promise<RemoteAccess> {
    const saved = (await readJson(savedPath(options.dataDir))) as Saved | undefined
    return new RemoteAccess(options, saved ?? { enabled: false, port: defaultRemotePort, devices: [] })
  }

  /** Where the listener is, while it is. */
  get url(): string | null {
    return this.server && this.server.url.replace(/^ws:/, 'http:').replace(/\/api$/, '')
  }

  state(): RemoteAccessState {
    return {
      enabled: this.saved.enabled,
      port: this.saved.port,
      error: this.error,
      pairing: this.pairing && { code: this.pairing.code, expiresAt: this.pairing.expiresAt },
      devices: this.saved.devices.map(({ tokenHash: _, pushSubscription: __, ...device }) => ({ ...device, connected: this.connected.has(device.id) })),
      tailscale: this.tailscale,
    }
  }

  /** Listens, if remote access is on. */
  async start(): Promise<void> {
    if (this.saved.enabled) await this.listen()
  }

  async configure({ enabled, port }: Pick<RemoteAccessState, 'enabled' | 'port'>): Promise<RemoteAccessState> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Not a port: ${port}`)
    // That address reaches the old port, not this one.
    if (port !== this.saved.port) this.tailscale = { ...this.tailscale, url: null }
    this.saved = { ...this.saved, enabled, port }
    await this.save()
    await this.stopListening()
    this.endPairing()
    this.error = null
    if (enabled) await this.listen()
    this.changed()
    return this.state()
  }

  async publish(): Promise<RemoteAccessState> {
    if (!this.server) throw new Error('Turn on remote access first.')
    const run = ++this.tailscaleRun
    const { port, publishedPort } = this.saved
    const tailscale = await this.options.tailscale.publish(port, publishedPort ?? null)
    if (run !== this.tailscaleRun || this.closed) return this.state()
    this.tailscale = tailscale
    this.saved = { ...this.saved, publishedPort: port }
    await this.save()
    this.changed()
    return this.state()
  }

  /** Shows a new code, which pairs one device within a few minutes and a few attempts. */
  startPairing(): RemoteAccessState {
    if (!this.server) throw new Error('Turn on remote access first.')
    this.endPairing()
    this.pairing = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: Date.now() + pairingLifetimeMs,
      attemptsLeft: pairingAttempts,
      expiry: setTimeout(() => {
        this.endPairing()
        this.changed()
      }, pairingLifetimeMs),
    }
    this.changed()
    return this.state()
  }

  /** Forgets the device and disconnects it, so it has to pair again. */
  async revoke(deviceId: string): Promise<RemoteAccessState> {
    this.saved = { ...this.saved, devices: this.saved.devices.filter((device) => device.id !== deviceId) }
    await this.save()
    for (const disconnect of this.connected.get(deviceId) ?? []) disconnect()
    this.changed()
    return this.state()
  }

  /** The devices to notify. Turning remote access off pauses them without forgetting their subscriptions. */
  pushTargets(): PushTarget[] {
    if (!this.saved.enabled) return []
    return this.saved.devices.flatMap(({ id, pushSubscription }) => pushSubscription ? [{ deviceId: id, subscription: pushSubscription }] : [])
  }

  async setPushSubscription(deviceId: string, subscription: PushSubscription): Promise<void> {
    const device = this.saved.devices.find((d) => d.id === deviceId)
    if (!device) return
    device.pushSubscription = subscription
    await this.save()
  }

  /** The browser withdrew this subscription, unless the device has since sent a newer one. */
  async forgetPushSubscription(deviceId: string, endpoint: string): Promise<void> {
    const device = this.saved.devices.find((d) => d.id === deviceId)
    if (device?.pushSubscription?.endpoint !== endpoint) return
    delete device.pushSubscription
    await this.save()
  }

  /** Waits for saves in flight. Devices disconnecting from now on aren't recorded as seen. */
  async close(): Promise<void> {
    this.closed = true
    this.endPairing()
    await this.stopListening()
    await Promise.allSettled([...this.writes])
  }

  private async listen(): Promise<void> {
    try {
      this.server = await ApiServer.start({
        port: this.saved.port,
        admits,
        connect: (hello, send, disconnect) => this.connect(hello, send, disconnect),
        request: (request, response) => void this.request(request, response).catch((error: unknown) => {
          console.error('Remote request failed:', error)
          if (!response.headersSent) response.writeHead(500)
          response.end()
        }),
      })
      void this.checkTailscale()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    }
  }

  /** In the background, since the command can be slow and the listener doesn't depend on it. */
  async checkTailscale(): Promise<void> {
    if (!this.server) return
    const run = ++this.tailscaleRun
    const tailscale = await this.options.tailscale.state(this.saved.port)
    if (run !== this.tailscaleRun || this.closed) return
    this.tailscale = tailscale
    this.changed()
  }

  private async stopListening(): Promise<void> {
    const server = this.server
    this.server = null
    await server?.close()
  }

  private connect({ token, activeProjectId }: Hello, send: SendEvent, disconnect: () => void): Connection | undefined {
    const hash = hashToken(token)
    const device = this.saved.devices.find((d) => timingSafeEqual(Buffer.from(d.tokenHash, 'hex'), hash))
    if (!device) return undefined
    const disconnects = this.connected.get(device.id) ?? new Set()
    disconnects.add(disconnect)
    this.connected.set(device.id, disconnects)
    this.seen(device)
    const connection = this.options.connect(send, { deviceId: device.id, activeProjectId: activeProjectId ?? null })
    return {
      handle: connection.handle,
      close: () => {
        connection.close()
        disconnects.delete(disconnect)
        if (disconnects.size === 0) this.connected.delete(device.id)
        this.seen(device)
      },
    }
  }

  private async request(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== pairPath) {
      return serveFile(this.options.rendererDir, request, response)
    }
    if (request.method !== 'POST') return void response.writeHead(405).end()
    // A form can't send JSON, so this also stops pages posting the code blind.
    if (!request.headers['content-type']?.startsWith('application/json')) return void response.writeHead(415).end()
    const body = await readBody(request)
    const { code, name } = (body ?? {}) as { code?: unknown; name?: unknown }
    if (typeof code !== 'string' || typeof name !== 'string') return sendJson(response, 400, { error: 'Expected a code and a name.' })
    try {
      sendJson(response, 200, { token: await this.pair(code, name) })
    } catch (error) {
      sendJson(response, 403, { error: (error as Error).message })
    }
  }

  private async pair(code: string, name: string): Promise<string> {
    const pairing = this.pairing
    if (!pairing) throw new Error('No code is waiting. Show one on the desktop with Pair a device.')
    if (!tokensMatch(code.replace(/\s/g, ''), pairing.code)) {
      pairing.attemptsLeft--
      if (pairing.attemptsLeft > 0) throw new Error("That code isn't right.")
      this.endPairing()
      this.changed()
      throw new Error("That code isn't right, and it can't be used again. Show a new one on the desktop.")
    }
    this.endPairing()
    const token = randomBytes(32).toString('base64url')
    const device: SavedDevice = {
      id: randomUUID(),
      name: name.trim().slice(0, maxNameLength) || 'Browser',
      tokenHash: hashToken(token).toString('hex'),
      pairedAt: Date.now(),
      lastSeenAt: null,
    }
    this.saved = { ...this.saved, devices: [...this.saved.devices, device] }
    await this.save()
    this.changed()
    return token
  }

  private endPairing(): void {
    if (this.pairing) clearTimeout(this.pairing.expiry)
    this.pairing = null
  }

  private seen(device: SavedDevice): void {
    if (this.closed) return
    device.lastSeenAt = Date.now()
    this.save().catch((error: unknown) => console.error("Couldn't save remote access:", error))
    this.changed()
  }

  private changed(): void {
    this.options.onChange(this.state())
  }

  private save(): Promise<void> {
    const write = writeJson(savedPath(this.options.dataDir), this.saved)
    this.writes.add(write)
    const settle = () => { this.writes.delete(write) }
    void write.then(settle, settle)
    return write
  }
}

/**
 * Only loopback names (for `ssh -L`) and tailnet names: any other `Host` is a
 * page whose DNS has been rebound to this machine. A browser's page must be
 * served from the same host it connects to.
 */
function admits(request: IncomingMessage): boolean {
  const host = request.headers.host?.toLowerCase()
  if (!host) return false
  const name = host.replace(/:\d+$/, '')
  if (name !== 'localhost' && name !== '127.0.0.1' && name !== '[::1]' && !name.endsWith('.ts.net')) return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function savedPath(dataDir: string): string {
  return join(dataDir, 'remote-access.json')
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > maxPairBodyBytes) return undefined
  }
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
}
