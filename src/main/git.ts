import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { join, posix } from 'node:path'
import watcher from '@parcel/watcher'
import type { FileContent } from '../shared/files'
import type {
  GitBlame,
  GitBranch,
  GitChange,
  GitCommit,
  GitCommitDetail,
  GitDiff,
  GitDiffRequest,
  GitHistory,
  GitRef,
  GitSummary,
} from '../shared/git'
import { ProjectWatches } from './project-watches'

const maxUntracked = 500
const maxCountedSize = 1024 * 1024
const maxBlobSize = 5 * 1024 * 1024
const commitCount = 300
const remoteTimeoutMs = 120_000
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
    // `matching` names an ignored directory rather than everything in it.
    git(root, [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=all',
      '--ignored=matching',
      ...scope,
    ]),
    git(root, ['diff', '--numstat', '-z', ...scope]),
    git(root, ['diff', '--cached', '--numstat', '-z', '-M', ...scope]),
  ])
  const summary = parseStatus(status.toString(), toProject)

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
    ignored: summary.ignored,
  }
}

/** Recent commits on every branch and tag, and the branches to switch to; `null` outside a repository. */
export async function gitHistory(root: string): Promise<GitHistory | null> {
  let prefix: string
  try {
    prefix = (await git(root, ['rev-parse', '--show-prefix'])).toString().trim()
  } catch (error) {
    if (error instanceof NotARepository) return null
    throw error
  }
  const [hasHead, branches] = await Promise.all([
    git(root, ['rev-parse', '--quiet', '--verify', 'HEAD']).then(
      () => true,
      () => false,
    ),
    git(root, ['for-each-ref', '--format=%(refname)%00%(HEAD)', 'refs/heads', 'refs/remotes']),
  ])
  // HEAD as well, in case it's detached.
  const revisions = ['--branches', '--remotes', '--tags', ...(hasHead ? ['HEAD'] : [])]
  // Limited to the project's commits only when it's part of a larger repository:
  // at the root, a pathspec would also hide merges that changed nothing.
  const commits = await log(root, [...revisions, ...(prefix ? ['--', '.'] : [])])
  return { commits, branches: parseBranches(branches.toString()) }
}

/** One commit and the files it changed in the project. */
export async function gitCommit(root: string, hash: string): Promise<GitCommitDetail> {
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).toString().trim()
  const toProject = (path: string) => posix.relative(`/${prefix}`, `/${path}`)
  const output = await git(root, ['show', '-s', '--decorate=full', `--format=${commitFormat}%x1f%b`, hash, '--'])
  const [fields, body = ''] = splitLast(output.toString(), '\x1f')
  const commit = parseCommit(fields)
  // A merge is compared with its first parent, as `git log -p --first-parent` would.
  const range = commit.parents[0] ? [commit.parents[0], commit.hash] : ['--root', commit.hash]
  const [nameStatus, numstat] = await Promise.all([
    git(root, ['diff-tree', '--no-commit-id', '-r', '-z', '-M', '--name-status', ...range, '--', '.']),
    git(root, ['diff-tree', '--no-commit-id', '-r', '-z', '-M', '--numstat', ...range, '--', '.']),
  ])
  const counts = parseNumstat(numstat.toString(), toProject)
  const changes = parseNameStatus(nameStatus.toString(), toProject).map((change) => ({
    ...change,
    lines: counts.get(change.path) ?? null,
  }))
  return { ...commit, body: body.trim(), changes }
}

/** Who last changed each line of `text`, the file's current content; `null` if git doesn't track it. */
export async function gitBlame(root: string, path: string, text: string): Promise<GitBlame | null> {
  let output: Buffer
  try {
    output = await git(root, ['blame', '--porcelain', '--contents', '-', '--', path], { stdin: text })
  } catch {
    // Untracked, or outside a repository: there's nothing to blame.
    return null
  }
  return parseBlame(output.toString())
}

/**
 * The file as last committed, to compare the editor's text with: empty if it's
 * added but not yet committed, `null` if git doesn't track it or it isn't text.
 */
export async function gitHeadText(root: string, path: string): Promise<string | null> {
  const head = await blob(root, `HEAD:./${path}`)
  if (head) return head.kind === 'text' ? head.text : null
  return (await blob(root, `:./${path}`)) ? '' : null
}

/** Switches to a local branch, or creates one tracking a remote branch. */
export async function gitSwitch(root: string, branch: Pick<GitBranch, 'kind' | 'name'>): Promise<void> {
  await git(root, branch.kind === 'remote' ? ['switch', '--track', branch.name] : ['switch', branch.name])
}

export async function gitPull(root: string): Promise<void> {
  await remote(root, ['pull'])
}

/** Pushes the current branch, setting `origin` as its upstream if it has none. */
export async function gitPush(root: string): Promise<void> {
  const hasUpstream = await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']).then(
    () => true,
    () => false,
  )
  await remote(root, hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD'])
}

/**
 * The project's files that git tracks or would track, relative to the project,
 * or `null` if git can't say, such as outside a repository or with no git installed.
 */
export async function gitFiles(root: string): Promise<string[] | null> {
  try {
    // Relative to the working directory, so already relative to the project.
    // The index still lists a deleted file until its deletion is staged.
    const [listed, deleted] = await Promise.all([
      git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate', '--', '.']),
      git(root, ['ls-files', '-z', '--deleted', '--', '.']),
    ])
    const missing = new Set(deleted.toString().split('\0'))
    return listed
      .toString()
      .split('\0')
      .filter((path) => path && !missing.has(path))
  } catch (error) {
    if (!(error instanceof NotARepository)) console.error(`Could not list the files of ${root} with git:`, error)
    return null
  }
}

/** Both sides of one file's change. `readWorktree` reads a file in the project. */
export async function gitDiff(
  root: string,
  { path, staged, from, commit }: GitDiffRequest,
  readWorktree: (path: string) => Promise<FileContent>,
): Promise<GitDiff> {
  // A missing blob reads as empty: a root commit has no parent, and an added or deleted file has one side.
  // A conflicted file has no plain index entry, so falls back to HEAD.
  const before = await firstBlob(
    root,
    commit
      ? [`${commit}^:./${from ?? path}`]
      : staged
        ? [`HEAD:./${from ?? path}`]
        : [`:./${path}`, `HEAD:./${path}`],
  )
  const after = commit
    ? await firstBlob(root, [`${commit}:./${path}`])
    : staged
      ? await firstBlob(root, [`:./${path}`])
      : worktreeSide(await readWorktree(path))
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

/** Watches projects' git directories, which change when anyone stages, commits or switches branch. */
export class GitWatcher {
  private readonly watches = new ProjectWatches((projectId) => this.subscribe(projectId))

  constructor(
    private readonly options: { projectPath: (projectId: string) => string; onChanged: (projectId: string) => void },
  ) {}

  /** Watches exactly these projects. */
  watch(projectIds: string[]): void {
    this.watches.set(projectIds)
  }

  unwatch(): Promise<void> {
    return this.watches.clear()
  }

  private subscribe(projectId: string) {
    const root = this.options.projectPath(projectId)
    return git(root, ['rev-parse', '--absolute-git-dir'])
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
  }
}

type ParsedStatus = Pick<
  GitSummary,
  'branch' | 'upstream' | 'conflicted' | 'staged' | 'unstaged' | 'untracked' | 'ignored'
> & {
  unborn: boolean
}

/** Parses `git status --porcelain=v2 -z --branch --ignored`. */
export function parseStatus(output: string, toProject: (path: string) => string): ParsedStatus {
  const parsed: ParsedStatus = {
    branch: null,
    upstream: null,
    unborn: false,
    conflicted: [],
    staged: [],
    unstaged: [],
    untracked: [],
    ignored: [],
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
    } else if (record.startsWith('! ')) {
      // `toProject` drops a directory's trailing slash.
      parsed.ignored.push(toProject(record.slice(2)))
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

/** Parses `git diff-tree --name-status -z`. */
export function parseNameStatus(output: string, toProject: (path: string) => string): GitChange[] {
  const changes: GitChange[] = []
  const records = output.split('\0').values()
  for (const record of records) {
    if (!record) continue
    const status = record.charAt(0)
    // A rename or copy (R100, C75) has the old path, then the new one.
    if (status === 'R' || status === 'C') {
      const from = toProject(records.next().value ?? '')
      changes.push({ path: toProject(records.next().value ?? ''), from, status, lines: null })
    } else {
      changes.push({ path: toProject(records.next().value ?? ''), status, lines: null })
    }
  }
  return changes
}

/** Parses `git for-each-ref --format=%(refname)%00%(HEAD)` over local and remote branches. */
export function parseBranches(output: string): GitBranch[] {
  const local: GitBranch[] = []
  const remote: GitBranch[] = []
  for (const line of output.split('\n')) {
    const [ref = '', head = ''] = line.split('\0')
    if (ref.startsWith('refs/heads/')) {
      local.push({ kind: 'local', name: ref.slice('refs/heads/'.length), current: head === '*' })
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      remote.push({ kind: 'remote', name: ref.slice('refs/remotes/'.length), current: false })
    }
  }
  // Switching to a remote branch creates a local one of the same name, which
  // fails if it already exists; that one is listed instead.
  const localNames = new Set(local.map((b) => b.name))
  return [...local, ...remote.filter((b) => !localNames.has(b.name.slice(b.name.indexOf('/') + 1)))]
}

/** Parses one `%D` decoration list, written with `--decorate=full` so branch kinds can be told apart. */
export function parseRefs(decorations: string): GitRef[] {
  const refs: GitRef[] = []
  for (const decoration of decorations.split(', ').filter(Boolean)) {
    const current = decoration.startsWith('HEAD -> ')
    const ref = current ? decoration.slice('HEAD -> '.length) : decoration
    if (ref === 'HEAD') refs.push({ kind: 'head', name: 'HEAD' })
    else if (ref.startsWith('tag: refs/tags/')) refs.push({ kind: 'tag', name: ref.slice('tag: refs/tags/'.length) })
    else if (ref.startsWith('refs/heads/'))
      refs.push({ kind: 'branch', name: ref.slice('refs/heads/'.length), ...(current ? { current } : {}) })
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD'))
      refs.push({ kind: 'remote', name: ref.slice('refs/remotes/'.length) })
  }
  // Git orders them by when they were loaded; local branches matter most.
  return refs.sort(
    (a, b) => refOrder.indexOf(a.kind) - refOrder.indexOf(b.kind) || a.name.localeCompare(b.name),
  )
}

const refOrder: GitRef['kind'][] = ['head', 'branch', 'remote', 'tag']

/** Parses `git blame --porcelain`, which describes each commit only on its first line. */
export function parseBlame(output: string): GitBlame {
  const blame: GitBlame = { commits: {}, lines: [] }
  let hash = ''
  let line = 0
  let pending: Partial<GitBlame['commits'][string]> | undefined
  for (const record of output.split('\n')) {
    if (record.startsWith('\t')) {
      if (pending) blame.commits[hash] = { shortHash: hash.slice(0, 7), author: '', at: 0, subject: '', ...pending }
      pending = undefined
      blame.lines[line - 1] = /^0+$/.test(hash) ? null : hash
      continue
    }
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(record)
    if (header) {
      hash = header[1]!
      line = Number(header[2])
      if (!(hash in blame.commits)) pending ??= {}
    } else if (pending) {
      const space = record.indexOf(' ')
      const key = record.slice(0, space)
      const value = record.slice(space + 1)
      if (key === 'author') pending.author = value
      else if (key === 'author-time') pending.at = Number(value) * 1000
      else if (key === 'summary') pending.subject = value
    }
  }
  return blame
}

const commitFormat = ['%H', '%h', '%P', '%an', '%at', '%D', '%s'].join('%x1f')

function parseCommit(record: string): GitCommit {
  const [hash = '', shortHash = '', parents = '', author = '', at = '', refs = '', subject = ''] = record.split('\x1f')
  return {
    hash,
    shortHash,
    subject,
    author,
    at: Number(at) * 1000,
    parents: parents.split(' ').filter(Boolean),
    refs: parseRefs(refs),
  }
}

async function log(root: string, args: string[]): Promise<GitCommit[]> {
  // --parents rewrites parents to skip commits a pathspec leaves out, so the graph stays connected.
  const output = await git(root, [
    'log',
    '-z',
    '--topo-order',
    '--parents',
    '--decorate=full',
    `-n${commitCount}`,
    `--format=${commitFormat}`,
    ...args,
  ])
  return output.toString().split('\0').filter(Boolean).map(parseCommit)
}

function splitLast(text: string, separator: string): [string, string] {
  const index = text.lastIndexOf(separator)
  return index === -1 ? [text, ''] : [text.slice(0, index), text.slice(index + 1)]
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
    const side = await blob(root, spec)
    if (side) return side
  }
  return { kind: 'text', text: '' }
}

/** A blob, or `null` if it doesn't exist. */
async function blob(root: string, spec: string): Promise<Side | null> {
  let buffer: Buffer
  try {
    buffer = await git(root, ['cat-file', 'blob', spec], { maxBuffer: maxBlobSize })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { kind: 'tooLarge' }
    return null
  }
  if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary' }
  try {
    return { kind: 'text', text: utf8.decode(buffer) }
  } catch {
    return { kind: 'binary' }
  }
}

function fields(record: string, count: number): string {
  // The path is last and may contain spaces.
  return record.split(' ').slice(count).join(' ')
}

/**
 * Talks to a remote with the user's own credentials (SSH agent, credential
 * helper). Nothing can answer a prompt, so git is told not to ask, and a
 * timeout ends anything else left waiting.
 */
function remote(cwd: string, args: string[]): Promise<Buffer> {
  return git(cwd, args, { timeout: remoteTimeoutMs, env: { GIT_TERMINAL_PROMPT: '0' } })
}

type GitOptions = { maxBuffer?: number; stdin?: string; timeout?: number; env?: Record<string, string> }

function git(
  cwd: string,
  args: string[],
  { maxBuffer = 64 * 1024 * 1024, stdin, timeout, env }: GitOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'buffer',
        maxBuffer,
        timeout,
        // No optional locks, so refreshing the summary never writes to the index,
        // which would trigger the watcher again and could collide with the user's
        // own git commands.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env },
      },
      (error, stdout, stderr) => {
        if (!error) resolve(stdout)
        else if (/not a git repository/i.test(stderr.toString())) reject(new NotARepository())
        // Git's own explanation is what the user needs to see.
        else reject(Object.assign(error, { message: stderr.toString().trim() || error.message }))
      },
    )
    child.stdin?.end(stdin)
  })
}
