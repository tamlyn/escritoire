import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TextQuery } from '../shared/search'
import { FileTextCache, searchFiles } from './project-search'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'escritoire-search-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const query = (text: string): TextQuery => ({ text, caseSensitive: false, wholeWord: false, regexp: false })
const search = (paths: string[], text: string, signal = new AbortController().signal) =>
  searchFiles(root, paths, query(text), signal)

test('finds matching lines in the order the files are listed', async () => {
  await writeFile(join(root, 'b.txt'), 'one\r\ntwo needle\r\n')
  await writeFile(join(root, 'a.txt'), 'needle\nnothing\nNEEDLE')
  const results = await search(['b.txt', 'a.txt', 'missing.txt'], 'needle')
  expect(results?.truncated).toBe(false)
  expect(results?.files.map((f) => [f.path, f.lines.map((l) => l.line)])).toEqual([
    ['b.txt', [2]],
    ['a.txt', [1, 3]],
  ])
})

test('skips binary files', async () => {
  await writeFile(join(root, 'image.bin'), Buffer.from('needle\0'))
  expect((await search(['image.bin'], 'needle'))?.files).toEqual([])
})

test('stops at its limit', async () => {
  await writeFile(join(root, 'many.txt'), 'needle\n'.repeat(1500))
  await writeFile(join(root, 'more.txt'), 'needle')
  const results = await search(['many.txt', 'more.txt'], 'needle')
  expect(results?.truncated).toBe(true)
  expect(results?.files.map((f) => [f.path, f.lines.length])).toEqual([['many.txt', 1000]])
})

test('gives up once aborted', async () => {
  await writeFile(join(root, 'a.txt'), 'needle')
  const controller = new AbortController()
  const searching = search(['a.txt'], 'needle', controller.signal)
  controller.abort()
  expect(await searching).toBeNull()
})

test('reads a file again once it has changed, though it keeps what it read', async () => {
  const cache = new FileTextCache()
  const cached = (text: string) => searchFiles(root, ['a.txt'], query(text), new AbortController().signal, cache)
  await writeFile(join(root, 'a.txt'), 'needle')
  expect((await cached('needle'))?.files).toHaveLength(1)
  await writeFile(join(root, 'a.txt'), 'haystack only')
  expect((await cached('needle'))?.files).toEqual([])
})
