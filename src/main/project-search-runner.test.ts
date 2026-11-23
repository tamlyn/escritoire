import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TextQuery } from '../shared/search'
import { ProjectSearchRunner } from './project-search-runner'

// Stands in for the real worker: answers at once, except that "hang" blocks it as a backtracking expression would.
const fakeWorker = `
import { parentPort } from 'node:worker_threads'
parentPort.on('message', (request) => {
  if (request.type !== 'search') return
  if (request.query.text === 'hang') for (;;) {}
  parentPort.postMessage({ type: 'results', id: request.id, results: { files: [{ path: request.query.text, lines: [] }], truncated: false } })
})
`

let directory: string
let runner: ProjectSearchRunner

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'escritoire-search-worker-'))
  const path = join(directory, 'worker.mjs')
  await writeFile(path, fakeWorker)
  runner = new ProjectSearchRunner({ path, stuckMs: 300 })
})

afterEach(async () => {
  runner.close()
  await rm(directory, { recursive: true, force: true })
})

const query = (text: string): TextQuery => ({ text, caseSensitive: false, wholeWord: false, regexp: true })
const search = (text: string, signal = new AbortController().signal) => runner.search('/project', [], query(text), signal)

test('answers from the worker', async () => {
  expect((await search('found'))?.files[0]?.path).toBe('found')
})

test('stops a search that blocks the worker, and searches again afterwards', async () => {
  await expect(search('hang')).rejects.toThrow('took too long')
  expect((await search('after'))?.files[0]?.path).toBe('after')
})

test('runs a newer search again in a new worker when one it replaced is stuck', async () => {
  const controller = new AbortController()
  const stuck = search('hang', controller.signal)
  controller.abort()
  expect(await stuck).toBeNull()
  expect((await search('newer'))?.files[0]?.path).toBe('newer')
})
