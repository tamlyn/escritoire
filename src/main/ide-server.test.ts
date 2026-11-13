import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { registerSupervisorTools } from './ide-tools'
import { IdeServer } from './ide-server'
import { Supervisor } from './supervisor'

let root: string
let supervisor: Supervisor
let server: IdeServer
const clients: Client[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-ide-server-')))
  supervisor = new Supervisor({ projectPath: () => root, send: () => {}, onChanged: () => {} })
  server = await IdeServer.start((mcp, projectId) => {
    if (projectId !== 'p' && projectId !== 'q') throw new Error('No such project')
    registerSupervisorTools(mcp, supervisor, projectId)
  })
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  await server.close()
  await supervisor.closeAll()
  await rm(root, { recursive: true, force: true })
})

async function connect(projectId: string, headers = server.connection(projectId).headers): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  const { url } = server.connection(projectId)
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }))
  clients.push(client)
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  return (result.content as { text: string }[]).map((c) => c.text).join('')
}

test('agents start and inspect processes in their own project', async () => {
  const client = await connect('p')
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual([
    'list_processes',
    'read_output',
    'recent_errors',
    'restart_process',
    'start_process',
    'stop_process',
  ])

  const started = await call(client, 'start_process', { command: 'echo "Error: no database"; sleep 30' })
  expect(started).toContain('Started.')
  expect(started).toContain('Error: no database')
  const id = /id: (\w+)/.exec(started)![1]!

  expect(await call(client, 'start_process', { command: 'echo "Error: no database"; sleep 30', cwd: root })).toContain(
    'Already running',
  )
  expect(await call(client, 'read_output', { id, grep: 'database' })).toBe('Error: no database')
  expect(await call(client, 'recent_errors')).toMatch(/\] echo .* \(\w+\)\nError: no database/)

  // Another project's agent sees none of it.
  const other = await connect('q')
  expect(await call(other, 'list_processes')).toBe('No processes.')
  const denied = await other.callTool({ name: 'read_output', arguments: { id } })
  expect(denied.isError).toBe(true)

  expect(await call(client, 'stop_process', { id })).toContain('status: stopped')
})

test('requests need the token and a known project', async () => {
  await expect(connect('p', { Authorization: 'Bearer wrong' })).rejects.toThrow()
  await expect(connect('nope')).rejects.toThrow()
})
