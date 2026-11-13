import { useMemo, useSyncExternalStore } from 'react'
import type { GitDiff, GitDiffRequest, GitSummary } from '../../../shared/git'
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

export function useGitDiff(projectId: string, { path, staged, from }: GitDiffRequest): GitDiff | undefined {
  const live = useMemo(
    () => new LiveGit(projectId, () => api.getGitDiff(projectId, { path, staged, from })),
    [projectId, path, staged, from],
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
