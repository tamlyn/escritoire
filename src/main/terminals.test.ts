import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ScreenOutput } from '../shared/screen'
import { Terminals } from './terminals'

let root: string
let output: ScreenOutput[]
let terminals: Terminals
const size = { cols: 80, rows: 24 }

beforeEach(async () => {
  vi.stubEnv('SHELL', '/bin/sh')
  vi.stubEnv('PS1', '$ ')
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-terminals-')))
  output = []
  terminals = newTerminals()
})

afterEach(async () => {
  await terminals.closeAll()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

function newTerminals() {
  return new Terminals({ dataDir: join(root, 'data'), projectPath: () => root, send: (o) => output.push(o) })
}

const received = () => output.map((o) => o.data).join('')

test('runs a shell in the project and keeps its screen for reattaching', async () => {
  await terminals.attach('p', 't', size)
  terminals.write('t', 'echo "dir: $(pwd)"\r')
  await vi.waitFor(() => expect(received()).toContain(`dir: ${root}`))

  terminals.detach('t')
  const sent = output.length
  terminals.write('t', 'echo hidden\r')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(output.length).toBe(sent)
  const snapshot = await terminals.attach('p', 't', size)
  expect(snapshot.data).toContain('hidden')
  expect(snapshot.data).toContain(`dir: ${root}`)
})

test('saves scrollback and directory when the project closes, and restores them once', async () => {
  await terminals.attach('p', 't', size)
  terminals.write('t', 'mkdir sub && cd sub && echo before-close\r')
  await vi.waitFor(() => expect(received()).toContain('before-close'))
  await terminals.closeProject('p')

  terminals = newTerminals()
  const restored = await terminals.attach('p', 't', size)
  expect(restored.data).toContain('before-close')
  expect(restored.data).toContain('Restored')
  terminals.write('t', 'pwd\r')
  await vi.waitFor(() => expect(received()).toContain(join(root, 'sub')))

  await terminals.close('p', 't')
  const fresh = await terminals.attach('p', 't', size)
  expect(fresh.data).not.toContain('before-close')
})

test('a key press after the shell exits starts a new one', async () => {
  await terminals.attach('p', 't', size)
  terminals.write('t', 'exit\r')
  await vi.waitFor(() => expect(received()).toContain('Shell exited'))
  terminals.write('t', 'x')
  terminals.write('t', 'echo again\r')
  await vi.waitFor(() => expect(received()).toMatch(/\r\nagain/))
})
