import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { gitBlame, gitCommit, gitDiff, gitFiles, gitHeadText, gitHistory, gitPull, gitPush, gitSummary, gitSwitch } from './git'
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
})

test('lists ignored files and directories, but not what is inside an ignored directory', async () => {
  git('init', '-q', '-b', 'main')
  await write('.gitignore', '*.log\nbuild/\n')
  await write('src/debug.log', 'x')
  await write('build/out/a.js', 'x')
  expect((await gitSummary(repo))?.ignored.sort()).toEqual(['build', 'src/debug.log'])
})

test('lists tracked and untracked files, but not deleted ones', async () => {
  git('init', '-q', '-b', 'main')
  await write('.gitignore', 'ignored.txt\n')
  await write('kept.txt', 'x')
  await write('deleted.txt', 'x')
  git('add', '.')
  await rm(join(repo, 'deleted.txt'))
  await write('ignored.txt', 'x')
  await write('untracked.txt', 'x')
  expect((await gitFiles(repo))?.sort()).toEqual(['.gitignore', 'kept.txt', 'untracked.txt'])
})

test('lists history across branches, with parents and refs', async () => {
  git('init', '-q', '-b', 'main')
  await write('a.txt', 'a\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  git('tag', 'v1')
  git('switch', '-qc', 'feature')
  await write('a.txt', 'b\n')
  git('commit', '-qam', 'On feature')
  git('switch', '-q', 'main')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('update-ref', 'refs/remotes/origin/elsewhere', 'HEAD')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')

  const history = await gitHistory(repo)
  const [feature, first] = history!.commits
  expect(feature).toMatchObject({ subject: 'On feature', parents: [first!.hash], refs: [{ kind: 'branch', name: 'feature' }] })
  expect(first).toMatchObject({
    subject: 'First commit',
    author: 'Test',
    parents: [],
    refs: [
      { kind: 'branch', name: 'main', current: true },
      { kind: 'remote', name: 'origin/elsewhere' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1' },
    ],
  })
  // origin/main is left out: switching to it would collide with main.
  expect(history!.branches).toEqual([
    { kind: 'local', name: 'feature', current: false },
    { kind: 'local', name: 'main', current: true },
    { kind: 'remote', name: 'origin/elsewhere', current: false },
  ])
})

test('has an empty history before the first commit', async () => {
  git('init', '-q', '-b', 'main')
  expect(await gitHistory(repo)).toEqual({ commits: [], branches: [] })
})

test('details a commit and diffs its files against the parent', async () => {
  git('init', '-q', '-b', 'main')
  await write('app/a.txt', 'one\n')
  await write('app/old.txt', 'moved\n')
  await write('outside.txt', 'x\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  await write('app/a.txt', 'one\ntwo\n')
  git('mv', 'app/old.txt', 'app/new.txt')
  await write('outside.txt', 'y\n')
  git('commit', '-qam', 'Second commit', '-m', 'With a body.')
  const project = join(repo, 'app')

  const [second, first] = (await gitHistory(project))!.commits
  expect(await gitCommit(project, second!.hash)).toMatchObject({
    subject: 'Second commit',
    body: 'With a body.',
    changes: [
      { path: 'a.txt', status: 'M', lines: { added: 1, removed: 0 } },
      { path: 'new.txt', from: 'old.txt', status: 'R', lines: { added: 0, removed: 0 } },
    ],
  })
  expect((await gitCommit(project, first!.hash)).changes.map((c) => [c.status, c.path])).toEqual([
    ['A', 'a.txt'],
    ['A', 'old.txt'],
  ])

  const unused = () => Promise.reject(new Error('reads no working tree'))
  expect(await gitDiff(project, { path: 'a.txt', staged: false, commit: second!.hash }, unused)).toEqual({
    kind: 'text',
    before: 'one\n',
    after: 'one\ntwo\n',
  })
  expect(await gitDiff(project, { path: 'a.txt', staged: false, commit: first!.hash }, unused)).toEqual({
    kind: 'text',
    before: '',
    after: 'one\n',
  })
})

test('blames the text being edited', async () => {
  git('init', '-q', '-b', 'main')
  await write('a.txt', 'one\ntwo\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')

  const blame = await gitBlame(repo, 'a.txt', 'one\nnew\ntwo\n')
  const [hash] = blame!.lines
  expect(blame!.lines).toEqual([hash, null, hash])
  expect(blame!.commits[hash!]).toMatchObject({ author: 'Test', subject: 'First commit', shortHash: hash!.slice(0, 7) })
  await write('untracked.txt', 'x\n')
  expect(await gitBlame(repo, 'untracked.txt', 'x\n')).toBeNull()
})

test('reads the committed text of a file to compare edits with', async () => {
  git('init', '-q', '-b', 'main')
  await write('a.txt', 'one\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  await write('a.txt', 'changed\n')
  await write('added.txt', 'x\n')
  git('add', 'added.txt')
  await write('untracked.txt', 'x\n')

  expect(await gitHeadText(repo, 'a.txt')).toBe('one\n')
  expect(await gitHeadText(repo, 'added.txt')).toBe('')
  expect(await gitHeadText(repo, 'untracked.txt')).toBeNull()
})

test('switches branches, and pushes and pulls through a remote', async () => {
  const remote = join(repo, 'remote.git')
  const clone = join(repo, 'clone')
  await mkdir(join(repo, 'work'))
  const inWork = (...args: string[]) => git('-C', 'work', ...args)
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  inWork('init', '-q', '-b', 'main')
  await write('work/a.txt', 'a\n')
  inWork('add', '.')
  inWork('commit', '-qm', 'First commit')
  inWork('remote', 'add', 'origin', remote)
  const work = join(repo, 'work')

  // With no upstream, pushing sets one.
  await gitPush(work)
  expect((await gitSummary(work))?.upstream).toMatchObject({ name: 'origin/main' })

  execFileSync('git', ['clone', '-q', remote, clone])
  await write('clone/b.txt', 'b\n')
  git('-C', 'clone', 'add', '.')
  git('-C', 'clone', 'commit', '-qm', 'From the clone')
  git('-C', 'clone', 'push', '-q')
  await gitPull(work)
  expect((await gitHistory(work))!.commits[0]).toMatchObject({ subject: 'From the clone' })

  inWork('branch', 'other')
  await gitSwitch(work, { kind: 'local', name: 'other' })
  expect((await gitSummary(work))?.branch).toBe('other')
  await expect(gitSwitch(work, { kind: 'local', name: 'missing' })).rejects.toThrow(/missing/)
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
  expect((await gitHistory(join(repo, 'app')))?.commits.map((c) => c.subject)).toEqual(['First commit'])
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

  const files = new ProjectFiles({ projectPath: () => repo, send: () => {}, trash: async () => {} })
  const diff = (path: string, staged: boolean, from?: string) =>
    gitDiff(repo, { path, staged, from }, (p) => files.readFile('p', p))

  expect(await diff('a.txt', true)).toEqual({ kind: 'text', before: 'committed\n', after: 'staged\n' })
  expect(await diff('a.txt', false)).toEqual({ kind: 'text', before: 'staged\n', after: 'working\n' })
  expect(await diff('new.txt', true, 'old.txt')).toEqual({ kind: 'text', before: 'renamed\n', after: 'renamed\n' })
  expect(await diff('untracked.txt', false)).toEqual({ kind: 'text', before: '', after: 'new\n' })
})
