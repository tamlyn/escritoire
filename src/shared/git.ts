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

/** A branch, remote-tracking branch or tag pointing at a commit; `head` is a detached HEAD. */
export type GitRef = {
  kind: 'branch' | 'remote' | 'tag' | 'head'
  name: string
  /** The checked-out branch. */
  current?: boolean
}

export type GitCommit = {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** Milliseconds since the epoch. */
  at: number
  /** First parent first. Limited to commits that touch the project when it's part of a larger repository. */
  parents: string[]
  refs: GitRef[]
}

export type GitCommitDetail = GitCommit & {
  body: string
  /** Compared with the first parent. */
  changes: GitChange[]
}

export type GitBranch = { kind: 'local' | 'remote'; name: string; current: boolean }

export type GitHistory = {
  /** Every local and remote branch and tag, newest first, in an order that suits a graph. */
  commits: GitCommit[]
  /** Local branches, and remote branches with no local branch of the same name. */
  branches: GitBranch[]
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
  /** Ignored files, and ignored directories without their contents. */
  ignored: string[]
}

/**
 * Which version of a file to compare. With `commit`, the commit against its
 * first parent. Otherwise staged is HEAD against the index, and unstaged the
 * index against the working tree.
 */
export type GitDiffRequest = { path: string; staged: boolean; from?: string; commit?: string }

export type GitDiff =
  | { kind: 'text'; before: string; after: string }
  | { kind: 'binary' }
  | { kind: 'tooLarge' }

/** Who last changed each line. */
export type GitBlame = {
  commits: Record<string, { shortHash: string; author: string; at: number; subject: string }>
  /** A commit hash per line, or `null` for a line not yet committed. */
  lines: (string | null)[]
}
