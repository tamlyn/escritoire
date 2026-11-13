import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { join, posix } from 'node:path'
import watcher, { type AsyncSubscription } from '@parcel/watcher'
import type { FileContent } from '../shared/files'
import type { GitChange, GitCommit, GitDiff, GitDiffRequest, GitSummary } from '../shared/git'

const maxUntracked = 500
const maxCountedSize = 1024 * 1024
const maxBlobSize = 5 * 1024 * 1024
const commitCount = 30
// The parts of a git directory that change without changing what the summary shows,
// or are large. The fsmonitor daemon writes a cookie on every status query, which
// would otherwise trigger another.
const unwatchedInGitDir = ['objects', 'logs', 'lfs', 'modules', 'fsmonitor--daemon']

class NotARepository extends Error {}

/** The project's changes and recent history, or `null` if it isn't in a git repository. */
export async function gitSummary(root: string): Promise<GitSummary | null> {
  let prefix: string
  try {
    prefix = (await git(root, ['rev-parse', '--show-prefix'])).toString().trim()
  } catch (error) {
    if (error instanceof NotARepository) return null
    throw error
  }
  // Git gives paths from the repository root, even when run in a subdirectory.
  const toProject = (path: string) => posix.relative(`/${prefix}`, `/${path}`)
  // Scoped to the project, which may be one part of a larger repository.
  const scope = ['--', '.']

  const [status, unstagedLines, stagedLines] = await Promise.all([
    git(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', ...scope]),
    git(root, ['diff', '--numstat', '-z', ...scope]),
    git(root, ['diff', '--cached', '--numstat', '-z', '-M', ...scope]),
  ])
  const summary = parseStatus(status.toString(), toProject)
  const commits = summary.unborn ? [] : await log(root, prefix ? scope : [])

  const unstagedCounts = parseNumstat(unstagedLines.toString(), toProject)
  const stagedCounts = parseNumstat(stagedLines.toString(), toProject)
  for (const change of summary.unstaged) change.lines = unstagedCounts.get(change.path) ?? null
  for (const change of summary.staged) change.lines = stagedCounts.get(change.path) ?? null

  const untracked = summary.untracked.slice(0, maxUntracked)
  await Promise.all(untracked.map(async (change) => (change.lines = await countLines(join(root, change.path)))))

  return {
    branch: summary.branch,
    upstream: summary.upstream,
    conflicted: summary.conflicted,
    staged: summary.staged,
    unstaged: summary.unstaged,
    untracked,
    untrackedOmitted: summary.untracked.length - untracked.length,
    commits,
  }
}

/** Both sides of one file's change. `readWorktree` reads a file in the project. */
export async function gitDiff(
  root: string,
  { path, staged, from }: GitDiffRequest,
  readWorktree: (path: string) => Promise<FileContent>,
): Promise<GitDiff> {
  // A conflicted file has no plain index entry, so falls back to HEAD.
  const before = await firstBlob(root, staged ? [`HEAD:./${from ?? path}`] : [`:./${path}`, `HEAD:./${path}`])
  const after = staged ? await firstBlob(root, [`:./${path}`]) : worktreeSide(await readWorktree(path))
  if (before.kind === 'tooLarge' || after.kind === 'tooLarge') return { kind: 'tooLarge' }
  if (before.kind === 'binary' || after.kind === 'binary') return { kind: 'binary' }
  return { kind: 'text', before: before.text, after: after.text }
}

function worktreeSide(content: FileContent): Side {
  switch (content.kind) {
    case 'text':
      return content
    case 'missing':
      return { kind: 'text', text: '' }
    case 'tooLarge':
      return { kind: 'tooLarge' }
    default:
      return { kind: 'binary' }
  }
}

/** Watches the active project's git directory, which changes when anyone stages, commits or switches branch. */
export class GitWatcher {
  private watched?: { projectId: string; subscription: Promise<AsyncSubscription | undefined> }

  constructor(
    private readonly options: { projectPath: (projectId: string) => string; onChanged: (projectId: string) => void },
  ) {}

  watch(projectId: string | null): void {
    if (this.watched?.projectId === projectId) return
    void this.unwatch()
    if (!projectId) return
    const root = this.options.projectPath(projectId)
    const subscription = git(root, ['rev-parse', '--absolute-git-dir'])
      .then((output) =>
        watcher.subscribe(
          output.toString().trim(),
          (error) => {
            if (error) console.error(`Watching the git directory of ${root} failed:`, error)
            else this.options.onChanged(projectId)
          },
          { ignore: unwatchedInGitDir },
        ),
      )
      .catch((error: unknown) => {
        if (!(error instanceof NotARepository)) console.error(`Could not watch the git directory of ${root}:`, error)
        return undefined
      })
    this.watched = { projectId, subscription }
  }

  unwatch(): Promise<void> {
    const watched = this.watched
    this.watched = undefined
    return watched ? watched.subscription.then((s) => s?.unsubscribe()) : Promise.resolve()
  }
}

type ParsedStatus = Pick<GitSummary, 'branch' | 'upstream' | 'conflicted' | 'staged' | 'unstaged' | 'untracked'> & {
  unborn: boolean
}

/** Parses `git status --porcelain=v2 -z --branch`. */
export function parseStatus(output: string, toProject: (path: string) => string): ParsedStatus {
  const parsed: ParsedStatus = {
    branch: null,
    upstream: null,
    unborn: false,
    conflicted: [],
    staged: [],
    unstaged: [],
    untracked: [],
  }
  // An iterator, so a record that spans two can take the next.
  const records = output.split('\0').values()
  for (const record of records) {
    if (record.startsWith('# ')) {
      const [key, ...values] = record.slice(2).split(' ')
      const value = values.join(' ')
      if (key === 'branch.oid') parsed.unborn = value === '(initial)'
      else if (key === 'branch.head') parsed.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') parsed.upstream = { name: value, ahead: 0, behind: 0 }
      else if (key === 'branch.ab' && parsed.upstream) {
        const [ahead = 0, behind = 0] = values.map((v) => Math.abs(Number(v)))
        parsed.upstream = { ...parsed.upstream, ahead, behind }
      }
    } else if (record.startsWith('? ')) {
      parsed.untracked.push({ path: toProject(record.slice(2)), status: '?', lines: null })
    } else if (record.startsWith('u ')) {
      parsed.conflicted.push({ path: toProject(fields(record, 10)), status: 'U', lines: null })
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const renamed = record.startsWith('2')
      const path = toProject(fields(record, renamed ? 9 : 8))
      // A rename's original path is the next record.
      const from = renamed ? toProject(records.next().value ?? '') : undefined
      const x = record.charAt(2)
      const y = record.charAt(3)
      if (x !== '.') parsed.staged.push({ path, ...(from ? { from } : {}), status: x, lines: null })
      if (y !== '.') parsed.unstaged.push({ path, status: y, lines: null })
    }
  }
  return parsed
}

/** Parses `git diff --numstat -z`, keyed by the (new) path. */
export function parseNumstat(output: string, toProject: (path: string) => string): Map<string, GitChange['lines']> {
  const counts = new Map<string, GitChange['lines']>()
  const records = output.split('\0').values()
  for (const record of records) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(record)
    if (!match) continue
    const [, added, removed, inline] = match
    let path = inline
    if (!path) {
      // A rename has an empty path, then the old and new paths as records of their own.
      records.next()
      path = records.next().value ?? ''
    }
    counts.set(
      toProject(path),
      added === '-' ? 'binary' : { added: Number(added), removed: Number(removed) },
    )
  }
  return counts
}

async function log(root: string, scope: string[]): Promise<GitCommit[]> {
  const format = ['%H', '%h', '%an', '%at', '%D', '%s'].join('%x1f')
  const output = await git(root, ['log', '-z', `-n${commitCount}`, `--format=${format}`, ...scope])
  return output
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', author = '', at = '', refs = '', subject = ''] = record.split('\x1f')
      return { hash, shortHash, author, at: Number(at) * 1000, subject, refs: refs ? refs.split(', ') : [] }
    })
}

async function countLines(file: string): Promise<GitChange['lines']> {
  let handle
  try {
    handle = await open(file, 'r')
    const { size } = await handle.stat()
    if (size > maxCountedSize) return null
    const buffer = await handle.readFile()
    if (buffer.subarray(0, 8000).includes(0)) return 'binary'
    let added = 0
    for (const byte of buffer) if (byte === 10) added++
    if (buffer.length > 0 && buffer[buffer.length - 1] !== 10) added++
    return { added, removed: 0 }
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

type Side = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'tooLarge' }
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** The first of the given blobs that exists, or empty if none does. */
async function firstBlob(root: string, specs: string[]): Promise<Side> {
  for (const spec of specs) {
    let buffer: Buffer
    try {
      buffer = await git(root, ['cat-file', 'blob', spec], maxBlobSize)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { kind: 'tooLarge' }
      continue
    }
    if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary' }
    try {
      return { kind: 'text', text: utf8.decode(buffer) }
    } catch {
      return { kind: 'binary' }
    }
  }
  return { kind: 'text', text: '' }
}

function fields(record: string, count: number): string {
  // The path is last and may contain spaces.
  return record.split(' ').slice(count).join(' ')
}

function git(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      // No optional locks, so refreshing the summary never writes to the index,
      // which would trigger the watcher again and could collide with the user's
      // own git commands.
      { cwd, encoding: 'buffer', maxBuffer, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout)
        else if (/not a git repository/i.test(stderr.toString())) reject(new NotARepository())
        else reject(Object.assign(error, { message: `${error.message}${stderr.toString()}` }))
      },
    )
  })
}
