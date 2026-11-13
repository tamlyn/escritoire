import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/** How an agent session reaches the IDE's tools for its project. */
export type IdeServerConnection = { url: string; headers: Record<string, string> }

/**
 * The IDE's MCP server, which every session the IDE launches is given. It
 * listens on loopback only and requires a token that changes on every launch;
 * each project has its own URL, so tools only ever see that project.
 */
export class IdeServer {
  private readonly token = randomBytes(32).toString('base64url')

  private constructor(
    private readonly server: Server,
    private readonly port: number,
  ) {}

  /** `register` adds the tools for one project, or throws if the project doesn't exist. */
  static async start(register: (server: McpServer, projectId: string) => void): Promise<IdeServer> {
    let ide: IdeServer | undefined
    const server = createServer((request, response) => {
      void ide!.handle(request, response, register).catch((error: unknown) => {
        console.error(error)
        if (!response.headersSent) response.writeHead(500).end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    ide = new IdeServer(server, (server.address() as AddressInfo).port)
    return ide
  }

  connection(projectId: string): IdeServerConnection {
    return {
      url: `http://127.0.0.1:${this.port}/projects/${encodeURIComponent(projectId)}/mcp`,
      headers: { Authorization: `Bearer ${this.token}` },
    }
  }

  close(): Promise<void> {
    this.server.closeAllConnections()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    register: (server: McpServer, projectId: string) => void,
  ): Promise<void> {
    if (!this.authorized(request.headers.authorization)) {
      response.writeHead(401).end()
      return
    }
    const projectId = /^\/projects\/([^/]+)\/mcp$/.exec(new URL(request.url ?? '/', 'http://localhost').pathname)?.[1]
    if (!projectId) {
      response.writeHead(404).end()
      return
    }

    // Stateless: a server per request, since the tools hold no state of their own.
    const mcp = new McpServer({ name: 'escritoire', version: '1' })
    try {
      register(mcp, decodeURIComponent(projectId))
    } catch {
      response.writeHead(404).end()
      return
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    response.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(request, response)
  }

  private authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`)
    const actual = Buffer.from(header ?? '')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
}
