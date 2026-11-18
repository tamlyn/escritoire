import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import type { Events } from '../shared/api'
import { type Hello, notAuthorized, type Push, type Reply, type Request } from '../shared/api-client'

export type ApiServerOptions = {
  /** 0 picks a free port. */
  port: number
  /**
   * Whether to serve a request at all, from its `Host` and `Origin`. Browsers
   * always send their page's origin, so this stops other pages in them using
   * the server. Other clients send none and rely on their token alone.
   */
  admits: (request: IncomingMessage) => boolean
  /**
   * Admits a client whose token is valid, saying how to serve it, or refuses
   * it with `undefined`. `disconnect` closes its connection once its token is revoked.
   */
  connect: (hello: Hello, send: SendEvent, disconnect: () => void) => Connection | undefined
  /** Plain HTTP requests, such as for files. Without it they get 404. */
  request?: (request: IncomingMessage, response: ServerResponse) => void
  heartbeatMs?: number
}

export type SendEvent = <K extends keyof Events>(name: K, payload: Events[K]) => void

/** One admitted client. `close` is called once it disconnects. */
export type Connection = {
  handle: (method: string, args: unknown[]) => Promise<unknown>
  close: () => void
}

const apiPath = '/api'
const helloTimeoutMs = 10_000
const policyViolation = 1008
const defaultHeartbeatMs = 20_000
/** A client this far behind recovers faster from a fresh snapshot than by catching up. */
const maxBufferedBytes = 8 * 1024 * 1024

/**
 * Main's API over a WebSocket on the loopback interface, speaking the protocol
 * in `shared/api-client.ts`. What each client may do and is sent is up to `connect`.
 */
export class ApiServer {
  private readonly sockets = new WebSocketServer({ noServer: true })

  static async start(options: ApiServerOptions): Promise<ApiServer> {
    const http = createServer((request, response) => {
      if (!options.request) response.writeHead(404).end()
      else if (!options.admits(request)) response.writeHead(403).end()
      else options.request(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(options.port, '127.0.0.1', () => {
        http.off('error', reject)
        resolve()
      })
    })
    return new ApiServer(http, options)
  }

  private constructor(
    private readonly http: Server,
    private readonly options: ApiServerOptions,
  ) {
    http.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '', 'http://localhost').pathname !== apiPath) return refuse(socket, '404 Not Found')
      if (!options.admits(request)) return refuse(socket, '403 Forbidden')
      this.sockets.handleUpgrade(request, socket, head, (client) => this.accept(client))
    })
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.http.address() as AddressInfo).port}${apiPath}`
  }

  async close(): Promise<void> {
    for (const client of this.sockets.clients) client.terminate()
    await new Promise<void>((resolve) => this.http.close(() => resolve()))
  }

  private accept(client: WebSocket): void {
    let connection: Connection | undefined
    const timeout = setTimeout(() => client.close(policyViolation, 'No token'), helloTimeoutMs)
    // A phone leaving range can hold its connection half-open for minutes, still counting as viewing.
    let answered = true
    client.on('pong', () => { answered = true })
    const heartbeat = setInterval(() => {
      if (!answered) return client.terminate()
      answered = false
      client.ping()
    }, this.options.heartbeatMs ?? defaultHeartbeatMs)
    client.on('close', () => {
      clearTimeout(timeout)
      clearInterval(heartbeat)
      connection?.close()
    })
    // A malformed frame; the socket closes itself.
    client.on('error', (error) => console.error('API client:', error))
    const send: SendEvent = (name, payload) => deliver(client, JSON.stringify({ event: name, payload } satisfies Push))
    client.on('message', (data, isBinary) => {
      // Once revoked, a client could keep sending until ws gives up waiting for it to close.
      if (client.readyState !== WebSocket.OPEN) return
      const message = isBinary ? undefined : parse(data)
      if (!connection) {
        clearTimeout(timeout)
        const disconnect = () => client.close(policyViolation, notAuthorized)
        connection = isHello(message) ? this.options.connect(message, send, disconnect) : undefined
        if (!connection) client.close(policyViolation, notAuthorized)
      } else if (isRequest(message)) {
        void this.reply(client, connection, message)
      } else {
        client.close(policyViolation, 'Malformed request')
      }
    })
  }

  private async reply(client: WebSocket, connection: Connection, { id, method, args }: Request): Promise<void> {
    let reply: string
    try {
      reply = JSON.stringify({ id, result: await connection.handle(method, args) } satisfies Reply)
    } catch (error) {
      console.error(`Error in ${method}:`, error)
      reply = JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) } satisfies Reply)
    }
    deliver(client, reply)
  }
}

function deliver(client: WebSocket, message: string): void {
  if (client.readyState !== WebSocket.OPEN) return
  if (client.bufferedAmount > maxBufferedBytes) client.terminate()
  else client.send(message)
}

/** Compares in constant time, so the time taken says nothing about how much matched. */
export function tokensMatch(given: string, expected: string): boolean {
  const hash = (token: string) => createHash('sha256').update(token).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
}

function parse(data: RawData): unknown {
  try {
    return JSON.parse(data.toString())
  } catch {
    return undefined
  }
}

function isHello(message: unknown): message is Hello {
  if (typeof message !== 'object' || message === null) return false
  const { token, activeProjectId } = message as Hello
  return typeof token === 'string' && (activeProjectId == null || typeof activeProjectId === 'string')
}

function isRequest(message: unknown): message is Request {
  if (typeof message !== 'object' || message === null) return false
  const { id, method, args } = message as Request
  return Number.isInteger(id) && typeof method === 'string' && Array.isArray(args)
}
