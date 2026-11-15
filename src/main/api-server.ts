import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import type { Events } from '../shared/api'
import type { Hello, Push, Reply, Request } from '../shared/api-client'

export type ApiServerOptions = {
  /** 0 picks a free port. */
  port: number
  /**
   * The pages allowed to connect. Browsers always send their page's origin, so
   * this stops any other page in them using the API. Other clients send none
   * and rely on their token alone.
   */
  origins: string[]
  isAuthorised: (token: string) => boolean
  handle: (method: string, args: unknown[]) => Promise<unknown>
}

const apiPath = '/api'
const helloTimeoutMs = 10_000
const policyViolation = 1008

/**
 * Main's API over a WebSocket on the loopback interface, speaking the protocol
 * in `shared/api-client.ts`. Events go to every client that has given a token.
 */
export class ApiServer {
  private readonly sockets = new WebSocketServer({ noServer: true })
  private readonly clients = new Set<WebSocket>()

  static async start(options: ApiServerOptions): Promise<ApiServer> {
    const http = createServer((_request, response) => { response.writeHead(404).end() })
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
      const origin = request.headers.origin
      if (origin !== undefined && !options.origins.includes(origin)) return refuse(socket, '403 Forbidden')
      this.sockets.handleUpgrade(request, socket, head, (client) => this.accept(client))
    })
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.http.address() as AddressInfo).port}${apiPath}`
  }

  send<K extends keyof Events>(name: K, payload: Events[K]): void {
    const message = JSON.stringify({ event: name, payload } satisfies Push)
    for (const client of this.clients) client.send(message)
  }

  async close(): Promise<void> {
    for (const client of this.sockets.clients) client.terminate()
    await new Promise<void>((resolve) => this.http.close(() => resolve()))
  }

  private accept(client: WebSocket): void {
    const timeout = setTimeout(() => client.close(policyViolation, 'No token'), helloTimeoutMs)
    client.on('close', () => {
      clearTimeout(timeout)
      this.clients.delete(client)
    })
    // A malformed frame; the socket closes itself.
    client.on('error', (error) => console.error('API client:', error))
    client.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : parse(data)
      if (!this.clients.has(client)) {
        clearTimeout(timeout)
        if (isHello(message) && this.options.isAuthorised(message.token)) this.clients.add(client)
        else client.close(policyViolation, 'Not authorised')
      } else if (isRequest(message)) {
        void this.reply(client, message)
      } else {
        client.close(policyViolation, 'Malformed request')
      }
    })
  }

  private async reply(client: WebSocket, { id, method, args }: Request): Promise<void> {
    let reply: string
    try {
      reply = JSON.stringify({ id, result: await this.options.handle(method, args) } satisfies Reply)
    } catch (error) {
      console.error(`Error in ${method}:`, error)
      reply = JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) } satisfies Reply)
    }
    if (client.readyState === WebSocket.OPEN) client.send(reply)
  }
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
  return typeof message === 'object' && message !== null && typeof (message as Hello).token === 'string'
}

function isRequest(message: unknown): message is Request {
  if (typeof message !== 'object' || message === null) return false
  const { id, method, args } = message as Request
  return Number.isInteger(id) && typeof method === 'string' && Array.isArray(args)
}
