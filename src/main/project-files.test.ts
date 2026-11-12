import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FilesChanged } from '../shared/files'
import { ProjectFiles } from './project-files'

let root: string
let sent: FilesChanged[]
let files: ProjectFiles

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-files-')))
  sent = []
  files = new ProjectFiles({ projectPath: () => root, send: (payload) => sent.push(payload) })
})

afterEach(async () => {
  await files.unwatch()
  await rm(root, { recursive: true, force: true })
})

test('lists directories first, in natural order, without .git', async () => {
  await mkdir(join(root, '.git'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'file10.txt'), '')
  await writeFile(join(root, 'file2.txt'), '')
  await writeFile(join(root, 'src', 'index.ts'), '')

  expect(await files.listDirectory('p', '')).toEqual([
    { name: 'src', path: 'src', isDirectory: true },
    { name: 'file2.txt', path: 'file2.txt', isDirectory: false },
    { name: 'file10.txt', path: 'file10.txt', isDirectory: false },
  ])
  expect(await files.listDirectory('p', 'src')).toEqual([
    { name: 'index.ts', path: 'src/index.ts', isDirectory: false },
  ])
})

test('reads text, and recognises binary, non-UTF-8 and missing files', async () => {
  await writeFile(join(root, 'config.json'), '\uFEFF{"a": 1}')
  await writeFile(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]))
  await writeFile(join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))

  // The byte order mark is kept, so saving writes it back.
  expect(await files.readFile('p', 'config.json')).toEqual({ kind: 'text', text: '\uFEFF{"a": 1}' })
  expect(await files.readFile('p', 'image.png')).toEqual({ kind: 'binary' })
  expect(await files.readFile('p', 'latin1.txt')).toEqual({ kind: 'notUtf8' })
  expect(await files.readFile('p', 'gone.txt')).toEqual({ kind: 'missing' })
})

test('overwrites files in place but never creates them', async () => {
  await writeFile(join(root, 'config.yaml'), 'a long first version\n')

  expect(await files.writeFile('p', 'config.yaml', 'short\n')).toBe('saved')
  expect(await readFile(join(root, 'config.yaml'), 'utf8')).toBe('short\n')
  expect(await files.writeFile('p', 'deleted.yaml', 'x')).toBe('missing')
  await expect(stat(join(root, 'deleted.yaml'))).rejects.toThrow('ENOENT')
})

test('refuses paths outside the project', async () => {
  await expect(files.readFile('p', '../secret')).rejects.toThrow('Outside the project')
  await expect(files.writeFile('p', '/etc/hosts', '')).rejects.toThrow('Outside the project')
})

test('reports changes made by others, but not its own writes or dependencies', async () => {
  await writeFile(join(root, 'mine.yaml'), 'a: 1')
  await mkdir(join(root, 'packages', 'a', 'node_modules', 'dep'), { recursive: true })
  files.watch('p')
  // macOS replays events from just before the watch started.
  await new Promise((resolve) => setTimeout(resolve, 300))
  sent = []

  await files.writeFile('p', 'mine.yaml', 'a: 2')
  await writeFile(join(root, 'packages', 'a', 'node_modules', 'dep', 'index.js'), '')
  await writeFile(join(root, 'theirs.yaml'), 'b: 1')

  await vi.waitFor(() => expect(sent.flatMap((s) => s.paths)).toContain('theirs.yaml'), { timeout: 3000 })
  expect(sent.flatMap((s) => s.paths)).toEqual(['theirs.yaml'])
  expect(sent[0]?.projectId).toBe('p')

  // Someone else changing the file straight after the IDE's write is still reported.
  await writeFile(join(root, 'mine.yaml'), 'a: 3')
  await vi.waitFor(() => expect(sent.flatMap((s) => s.paths)).toContain('mine.yaml'), { timeout: 3000 })
})
