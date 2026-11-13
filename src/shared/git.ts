/** Paths are relative to the project root, which may be a subdirectory of the repository. */
export type GitChange = {
  path: string
  /** Where a renamed or copied file came from. */
  from?: string
  /** The letter `git status` shows: M, A, D, R, C or T; U for a conflict, ? when untracked. */
  status: string
  /** Lines added and removed; `null` when not counted. */
  lines: { added: number; removed: number } | 'binary' | null
}

export type GitCommit = {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** Milliseconds since the epoch. */
  at: number
  /** Branches and tags pointing at it, as `git log --decorate` shows them. */
  refs: string[]
}

export type GitSummary = {
  /** `null` when HEAD is detached. */
  branch: string | null
  upstream: { name: string; ahead: number; behind: number } | null
  conflicted: GitChange[]
  staged: GitChange[]
  unstaged: GitChange[]
  untracked: GitChange[]
  /** Untracked files beyond those listed, which are capped. */
  untrackedOmitted: number
  /** Newest first. */
  commits: GitCommit[]
}

/** Which version of a file to compare: staged is HEAD against the index, otherwise the index against the working tree. */
export type GitDiffRequest = { path: string; staged: boolean; from?: string }

export type GitDiff =
  | { kind: 'text'; before: string; after: string }
  | { kind: 'binary' }
  | { kind: 'tooLarge' }
