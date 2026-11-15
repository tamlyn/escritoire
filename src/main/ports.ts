import { execFile } from 'node:child_process'
import { request } from 'node:http'
import { promisify } from 'node:util'

const run = promisify(execFile)
const probeTimeoutMs = 1000

/** A TCP socket a process is listening on. `address` is bare: no brackets or interface scope. */
export type ListeningSocket = { pid: number; address: string; port: number }

/**
 * Every TCP socket the user's processes are listening on. macOS has lsof but
 * no ss; RHEL 8 always has ss but a minimal install may lack lsof.
 */
export async function listeningSockets(): Promise<ListeningSocket[]> {
  const [command, args, parse] =
    process.platform === 'linux'
      ? ['ss', ['-Htlnp'], parseSs]
      : ['lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], parseLsof]
  try {
    return parse((await run(command, args)).stdout)
  } catch (error) {
    // lsof exits 1 when nothing is listening; a missing tool means no ports.
    return parse((error as { stdout?: string }).stdout ?? '')
  }
}

/** lsof's field output: a `p<pid>` line, then `f<fd>` and `n<address>:<port>` lines for each socket. */
export function parseLsof(output: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = []
  let pid = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n')) {
      const endpoint = parseEndpoint(line.slice(1))
      if (endpoint) sockets.push({ pid, ...endpoint })
    }
  }
  return sockets
}

/** `LISTEN 0 511 0.0.0.0:5173 0.0.0.0:* users:(("node",pid=1234,fd=23),...)` */
export function parseSs(output: string): ListeningSocket[] {
  return output.split('\n').flatMap((line) => {
    const endpoint = parseEndpoint(line.trim().split(/\s+/)[3] ?? '')
    if (!endpoint) return []
    return [...line.matchAll(/pid=(\d+)/g)].map((match) => ({ pid: Number(match[1]), ...endpoint }))
  })
}

function parseEndpoint(text: string): { address: string; port: number } | null {
  const colon = text.lastIndexOf(':')
  const port = Number(text.slice(colon + 1))
  if (colon < 0 || !Number.isInteger(port) || port <= 0) return null
  const address = text.slice(0, colon).replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  return { address, port }
}

/** Each process's children, from one `ps` of every process. */
export async function processChildren(): Promise<Map<number, number[]>> {
  const children = new Map<number, number[]>()
  const { stdout } = await run('ps', ['-A', '-o', 'pid=', '-o', 'ppid='])
  for (const line of stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || ppid === undefined) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  return children
}

export function descendants(children: Map<number, number[]>, pid: number): Set<number> {
  const found = new Set([pid])
  for (const parent of found) for (const child of children.get(parent) ?? []) found.add(child)
  return found
}

/** Where a browser can open the port, or null if it doesn't answer HTTP. */
export async function httpUrl(addresses: string[], port: number): Promise<string | null> {
  const local = addresses.find(isLocal)
  const host = local === undefined ? addresses[0] : 'localhost'
  if (host === undefined || !(await servesHttp(host, port))) return null
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}/`
}

function isLocal(address: string): boolean {
  return ['*', '0.0.0.0', '::', '::1'].includes(address) || /^(::ffff:)?127\./.test(address)
}

function servesHttp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host, port, method: 'HEAD', path: '/', timeout: probeTimeoutMs }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}
