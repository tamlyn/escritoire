import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Serves the files under `root`, with `index.html` for `/`. Built assets have hashed names, so they never change. */
export async function serveFile(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return void response.writeHead(405).end()
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    return void response.writeHead(400).end()
  }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = resolve(root, relative)
  if (!file.startsWith(resolve(root) + sep)) return void response.writeHead(404).end()
  const stats = await stat(file).catch(() => null)
  if (!stats?.isFile()) return void response.writeHead(404).end()
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file).pipe(response)
}
