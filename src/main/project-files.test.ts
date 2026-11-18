import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
  files = new ProjectFiles({
    projectPath: () => root,
    send: (payload) => sent.push(payload),
    trash: (path) => rm(path, { recursive: true }),
  })
})

afterEach(async () => {
  await files.unwatch()
  await rm(root, { recursive: true, force: true })
})

test('reports changes to an open file outside the project, but not its own writes', async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-outside-')))
  const file = join(outside, 'plan.md')
  await writeFile(file, 'one')
  await files.readFile('p', file)
  await new Promise((done) => setTimeout(done, 100))
  sent.length = 0

  await files.writeFile('p', file, 'two', 'one')
  await new Promise((done) => setTimeout(done, 200))
  expect(sent).toEqual([])

  await writeFile(file, 'three')
  await vi.waitFor(() => expect(sent).toContainEqual({ projectId: 'p', paths: [file] }))
  await rm(outside, { recursive: true, force: true })
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

test('creates files and the directories they need, but never replaces one', async () => {
  await files.createFile('p', 'docs/notes/auth.md')
  expect(await readFile(join(root, 'docs', 'notes', 'auth.md'), 'utf8')).toBe('')

  await writeFile(join(root, 'docs', 'notes', 'auth.md'), 'kept')
  await expect(files.createFile('p', 'docs/notes/auth.md')).rejects.toThrow('already exists')
  expect(await readFile(join(root, 'docs', 'notes', 'auth.md'), 'utf8')).toBe('kept')
  await expect(files.createFile('p', '../escaped.md')).rejects.toThrow('Outside the project')
})

test('names scratch files for when they were made', async () => {
  const now = new Date(2026, 10, 5, 9, 7)
  expect(await files.createScratchFile('p', 'sql', now)).toBe('.scratch/2026-11-05-0907.sql')
  expect(await files.createScratchFile('p', 'sql', now)).toBe('.scratch/2026-11-05-0907-2.sql')
  await expect(files.createScratchFile('p', '../x', now)).rejects.toThrow('Not a file extension')
})

test('renames and moves without replacing anything', async () => {
  await writeFile(join(root, 'a.md'), 'a')
  await writeFile(join(root, 'b.md'), 'b')

  await files.rename('p', 'a.md', 'notes/kept.md')
  expect(await readFile(join(root, 'notes', 'kept.md'), 'utf8')).toBe('a')
  await expect(files.rename('p', 'b.md', 'notes/kept.md')).rejects.toThrow('already exists')
  expect(await readFile(join(root, 'notes', 'kept.md'), 'utf8')).toBe('a')

  // A change of case alone, which a case-insensitive file system sees as the same name.
  await files.rename('p', 'b.md', 'B.md')
  expect(await readdir(root)).toContain('B.md')
})

test('trashes a symlink rather than what it links to', async () => {
  await writeFile(join(root, 'target.md'), 'x')
  await symlink(join(root, 'target.md'), join(root, 'link.md'))

  await files.delete('p', 'link.md')
  expect(await readdir(root)).toEqual(['target.md'])
  await expect(files.delete('p', '')).rejects.toThrow('Not a file name')
})

test('reads and writes files outside the project, but changes only its tree', async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-outside-')))
  try {
    await writeFile(join(outside, 'notes.md'), 'a')
    expect(await files.writeFile('p', join(outside, 'notes.md'), 'b')).toBe('saved')
    expect(await files.readFile('p', join(outside, 'notes.md'))).toEqual({ kind: 'text', text: 'b' })
    await expect(files.listDirectory('p', '..')).rejects.toThrow('Outside the project')
    await expect(files.delete('p', join(outside, 'notes.md'))).rejects.toThrow('Outside the project')
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('reports changes made by others, but not its own writes or dependencies', async () => {
  await writeFile(join(root, 'mine.yaml'), 'a: 1')
  await mkdir(join(root, 'packages', 'a', 'node_modules', 'dep'), { recursive: true })
  files.watch(['p'])
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


test('serializes writes through canonical aliases and rejects stale saves', async () => {
  await writeFile(join(root, 'file.txt'), 'original')
  await symlink(join(root, 'file.txt'), join(root, 'alias.txt'))
  await Promise.all([
    files.writeFile('p', 'file.txt', 'a'.repeat(100000)),
    files.writeFile('p', 'alias.txt', 'last'),
  ])
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('last')
  await expect(files.writeFile('p', 'file.txt', 'stale', 'original')).rejects.toThrow('changed on disk')
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('last')
})

test('leaves links outside the project out of the tree', async () => {
  await symlink(tmpdir(), join(root, 'outside'))
  await expect(files.listDirectory('p', 'outside')).rejects.toThrow('Outside the project')
  expect(await files.listDirectory('p', '')).toEqual([])
})
