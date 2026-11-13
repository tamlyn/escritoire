import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { gitDiff, gitSummary } from './git'
import { ProjectFiles } from './project-files'

let repo: string

beforeEach(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-git-')))
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

function git(...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo })
}

async function write(path: string, text: string | Buffer) {
  await mkdir(join(repo, path, '..'), { recursive: true })
  await writeFile(join(repo, path), text)
}

test('is null outside a repository', async () => {
  expect(await gitSummary(repo)).toBeNull()
})

test('summarises a repository with no commits', async () => {
  git('init', '-q', '-b', 'main')
  await write('new.txt', 'a\nb')
  expect(await gitSummary(repo)).toMatchObject({
    branch: 'main',
    upstream: null,
    untracked: [{ path: 'new.txt', status: '?', lines: { added: 2, removed: 0 } }],
    commits: [],
  })
})

test('separates staged, unstaged and untracked changes, with line counts', async () => {
  git('init', '-q', '-b', 'main')
  await write('a.txt', 'one\ntwo\n')
  await write('old name.txt', 'moved\n')
  await write('image.bin', Buffer.from([0, 1, 2]))
  git('add', '.')
  git('commit', '-qm', 'First commit')
  git('tag', 'v1')

  await write('a.txt', 'one\nTWO\nthree\n')
  git('add', 'a.txt')
  await write('a.txt', 'one\nTWO\nthree\nfour\n')
  git('mv', 'old name.txt', 'new name.txt')
  await write('image.bin', Buffer.from([0, 9]))
  await write('dir/untracked.txt', 'x\n')

  const summary = await gitSummary(repo)
  expect(summary).toMatchObject({
    branch: 'main',
    staged: [
      { path: 'a.txt', status: 'M', lines: { added: 2, removed: 1 } },
      { path: 'new name.txt', from: 'old name.txt', status: 'R', lines: { added: 0, removed: 0 } },
    ],
    unstaged: [
      { path: 'a.txt', status: 'M', lines: { added: 1, removed: 0 } },
      { path: 'image.bin', status: 'M', lines: 'binary' },
    ],
    untracked: [{ path: 'dir/untracked.txt', lines: { added: 1, removed: 0 } }],
    untrackedOmitted: 0,
  })
  expect(summary!.commits).toEqual([
    expect.objectContaining({ subject: 'First commit', author: 'Test', refs: ['HEAD -> main', 'tag: v1'] }),
  ])
})

test('scopes to a project inside a larger repository', async () => {
  git('init', '-q', '-b', 'main')
  await write('outside.txt', 'x\n')
  await write('app/inside.txt', 'x\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  await write('outside.txt', 'y\n')
  await write('app/inside.txt', 'y\n')
  await write('outside-new.txt', 'y\n')
  await write('app/inside-new.txt', 'y\n')
  git('add', 'outside.txt')
  git('commit', '-qm', 'Outside only')

  const summary = await gitSummary(join(repo, 'app'))
  expect(summary?.unstaged.map((c) => c.path)).toEqual(['inside.txt'])
  expect(summary?.untracked.map((c) => c.path)).toEqual(['inside-new.txt'])
  expect(summary?.commits.map((c) => c.subject)).toEqual(['First commit'])
})

test('shows both sides of a staged or unstaged change', async () => {
  git('init', '-q', '-b', 'main')
  await write('a.txt', 'committed\n')
  await write('old.txt', 'renamed\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  await write('a.txt', 'staged\n')
  git('add', 'a.txt')
  await write('a.txt', 'working\n')
  git('mv', 'old.txt', 'new.txt')
  await write('untracked.txt', 'new\n')

  const files = new ProjectFiles({ projectPath: () => repo, send: () => {} })
  const diff = (path: string, staged: boolean, from?: string) =>
    gitDiff(repo, { path, staged, from }, (p) => files.readFile('p', p))

  expect(await diff('a.txt', true)).toEqual({ kind: 'text', before: 'committed\n', after: 'staged\n' })
  expect(await diff('a.txt', false)).toEqual({ kind: 'text', before: 'staged\n', after: 'working\n' })
  expect(await diff('new.txt', true, 'old.txt')).toEqual({ kind: 'text', before: 'renamed\n', after: 'renamed\n' })
  expect(await diff('untracked.txt', false)).toEqual({ kind: 'text', before: '', after: 'new\n' })
})
