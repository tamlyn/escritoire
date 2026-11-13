import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { GitCommitDetail, GitDiff, GitDiffRequest, GitHistory, GitSummary } from '../../../shared/git'
import { api, subscribe } from '../api'

// A burst of changes, such as an agent writing several files or a commit,
// becomes one reload.
const reloadDelayMs = 300

/**
 * A value loaded from git, kept current while anything is subscribed. Reloads
 * when main says the project changed, never running two loads at once.
 */
class LiveGit<T> {
  private value: T | undefined
  private readonly listeners = new Set<() => void>()
  private loading = false
  private reloadQueued = false
  private stop?: () => void

  constructor(
    private readonly projectId: string,
    private readonly load: () => Promise<T>,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop?.()
    }
  }

  getSnapshot = (): T | undefined => this.value

  private start() {
    this.reload()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribe('gitChanged', ({ projectId }) => {
      if (projectId !== this.projectId || timer) return
      timer = setTimeout(() => {
        timer = undefined
        this.reload()
      }, reloadDelayMs)
    })
    this.stop = () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }

  private reload() {
    if (this.loading) {
      this.reloadQueued = true
      return
    }
    this.loading = true
    void this.load()
      .then(
        (value) => {
          this.value = value
          for (const listener of this.listeners) listener()
        },
        (error: unknown) => console.error(error),
      )
      .finally(() => {
        this.loading = false
        if (this.reloadQueued) {
          this.reloadQueued = false
          this.reload()
        }
      })
  }
}

// Kept across project switches, so switching back shows the last summary while it reloads.
const summaries = new Map<string, LiveGit<GitSummary | null>>()

/** `undefined` while loading; `null` if the project isn't in a git repository. */
export function useGitSummary(projectId: string): GitSummary | null | undefined {
  let live = summaries.get(projectId)
  if (!live) {
    live = new LiveGit(projectId, () => api.getGitSummary(projectId))
    summaries.set(projectId, live)
  }
  return useSyncExternalStore(live.subscribe, live.getSnapshot)
}

const histories = new Map<string, LiveGit<GitHistory | null>>()

/** `undefined` while loading; `null` if the project isn't in a git repository. */
export function useGitHistory(projectId: string): GitHistory | null | undefined {
  let live = histories.get(projectId)
  if (!live) {
    live = new LiveGit(projectId, () => api.getGitHistory(projectId))
    histories.set(projectId, live)
  }
  return useSyncExternalStore(live.subscribe, live.getSnapshot)
}

/** A commit never changes, so is loaded once. */
export function useGitCommit(projectId: string, hash: string): GitCommitDetail | Error | undefined {
  const [commit, setCommit] = useState<GitCommitDetail | Error>()
  useEffect(() => {
    let cancelled = false
    setCommit(undefined)
    void api.getGitCommit(projectId, hash).then(
      (loaded) => !cancelled && setCommit(loaded),
      (error: unknown) => !cancelled && setCommit(error instanceof Error ? error : new Error(String(error))),
    )
    return () => {
      cancelled = true
    }
  }, [projectId, hash])
  return commit
}

export function useGitDiff(projectId: string, { path, staged, from, commit }: GitDiffRequest): GitDiff | undefined {
  const live = useMemo(
    () => new LiveGit(projectId, () => api.getGitDiff(projectId, { path, staged, from, commit })),
    [projectId, path, staged, from, commit],
  )
  return useSyncExternalStore(live.subscribe, live.getSnapshot)
}

/** Files with any change, counting a file that is both staged and changed again once. */
export function changedFileCount(summary: GitSummary): number {
  const paths = new Set(
    [...summary.conflicted, ...summary.staged, ...summary.unstaged, ...summary.untracked].map((c) => c.path),
  )
  return paths.size + summary.untrackedOmitted
}

/** IPC prefixes a remote error with the channel name, which means nothing to the user. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
