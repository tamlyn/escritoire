import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Supervisor } from './supervisor'

let root: string
let supervisor: Supervisor

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-supervisor-')))
  await mkdir(join(root, 'web'))
  supervisor = new Supervisor({ projectPath: () => root, send: () => {}, onChanged: () => {} })
})

afterEach(async () => {
  await supervisor.closeAll()
  await rm(root, { recursive: true, force: true })
})

const outputOf = (id: string) => supervisor.output('p', id, 100).map((l) => l.text)

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('one process per directory and command, however the directory is written', async () => {
  const command = 'echo "in $(pwd)"; sleep 30'
  const { process: first, alreadyRunning } = await supervisor.start('p', { command, cwd: 'web' })
  expect(alreadyRunning).toBe(false)
  expect(first).toMatchObject({ command, cwd: 'web', status: 'running' })

  const again = await Promise.all([
    supervisor.start('p', { command: `  ${command.replace(' ', '   ')}`, cwd: join(root, 'web') }),
    supervisor.start('p', { command, cwd: './web/../web/' }),
  ])
  expect(again.map((r) => [r.process.id, r.alreadyRunning])).toEqual([
    [first.id, true],
    [first.id, true],
  ])
  expect(supervisor.list('p')).toHaveLength(1)
  await vi.waitFor(() => expect(outputOf(first.id)).toContain(`in ${join(root, 'web')}`))

  await expect(supervisor.start('p', { command, cwd: '..' })).rejects.toThrow('outside the project')
  expect(() => supervisor.output('other', first.id, 1)).toThrow('No process')
})

test('stop ends the whole process group', async () => {
  const { process: info } = await supervisor.start('p', { command: 'sleep 300 & echo "child $!"; wait' })
  const pid = await vi.waitFor(() => {
    const line = outputOf(info.id).find((l) => l.startsWith('child '))
    expect(line).toBeDefined()
    return Number(line!.slice(6))
  })
  expect(isAlive(pid)).toBe(true)
  await supervisor.stop('p', info.id)
  expect(supervisor.list('p')[0]).toMatchObject({ status: 'stopped' })
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false))
})

test('records how a process ended, and restarts it in place', async () => {
  const { process: failing } = await supervisor.start('p', { command: 'echo "Error: boom"; exit 3' })
  await vi.waitFor(() => expect(supervisor.list('p')[0]).toMatchObject({ status: 'failed', exitCode: 3 }))
  expect(supervisor.errorsSince('p', 0)).toMatchObject([{ processId: failing.id, text: 'Error: boom' }])

  await supervisor.restart('p', failing.id)
  await vi.waitFor(() => expect(outputOf(failing.id).filter((l) => l === 'Error: boom')).toHaveLength(2))
  expect(outputOf(failing.id)).toContain('── Restarted ──')

  const { process: ok } = await supervisor.start('p', { command: 'true' })
  await vi.waitFor(() => expect(supervisor.list('p').find((p) => p.id === ok.id)).toMatchObject({ status: 'exited' }))
  supervisor.remove('p', ok.id)
  expect(supervisor.list('p').map((p) => p.id)).toEqual([failing.id])
})

test('a task and the command it runs are the same process', async () => {
  await writeFile(join(root, 'web', 'package.json'), JSON.stringify({ scripts: { hello: 'echo hi; sleep 30' } }))
  await writeFile(join(root, 'pnpm-lock.yaml'), '')
  const { process: info } = await supervisor.start('p', { task: { file: join(root, 'web', 'package.json'), name: 'hello' } })
  expect(info).toMatchObject({ command: 'pnpm run hello', cwd: 'web', task: { file: 'web/package.json', name: 'hello' } })
  const byCommand = await supervisor.start('p', { command: 'pnpm run hello', cwd: 'web' })
  expect(byCommand).toMatchObject({ process: { id: info.id }, alreadyRunning: true })
})

// Without this the IDE would need a helper process to clean up after a crash.
test('processes die with the app that owns their pty', async () => {
  const nodePty = createRequire(import.meta.url).resolve('node-pty')
  const script = join(root, 'owner.cjs')
  await writeFile(
    script,
    `const pty = require(${JSON.stringify(nodePty)})
     const p = pty.spawn('/bin/sh', ['-c', 'sleep 300 & echo "pids $$ $!"; wait'], {})
     p.onData((d) => process.stdout.write(d))`,
  )
  const owner = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  owner.stdout.on('data', (d) => (out += d))
  const pids = await vi.waitFor(() => {
    const match = /pids (\d+) (\d+)/.exec(out)
    expect(match).not.toBeNull()
    return [Number(match![1]), Number(match![2])]
  })
  expect(pids.every(isAlive)).toBe(true)
  owner.kill('SIGKILL')
  await vi.waitFor(() => expect(pids.filter(isAlive)).toEqual([]), { timeout: 3000 })
})
