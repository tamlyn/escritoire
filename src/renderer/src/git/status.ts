import type { GitSummary } from '../../../shared/git'

/** Text colours for the letters `git status` shows, readable on either theme. */
export const statusColours: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  T: 'text-amber-600 dark:text-amber-400',
  A: 'text-green-600 dark:text-green-400',
  '?': 'text-green-600 dark:text-green-400',
  D: 'text-red-600 dark:text-red-400',
  U: 'text-red-600 dark:text-red-400',
  R: 'text-blue-600 dark:text-blue-400',
  C: 'text-blue-600 dark:text-blue-400',
}

export const statusNames: Record<string, string> = {
  M: 'modified',
  T: 'type changed',
  A: 'added',
  '?': 'untracked',
  D: 'deleted',
  U: 'conflicted',
  R: 'renamed',
  C: 'copied',
}

// Most important first: a directory shows the first that anything inside it has.
const precedence = ['U', 'D', 'M', 'T', 'R', 'C', 'A', '?']

const statusesBySummary = new WeakMap<GitSummary, Map<string, string>>()

/** One status per changed file: a conflict, else its unstaged change, else its staged one. */
export function fileStatuses(summary: GitSummary): Map<string, string> {
  let statuses = statusesBySummary.get(summary)
  if (!statuses) {
    statuses = new Map()
    for (const change of [...summary.untracked, ...summary.staged, ...summary.unstaged, ...summary.conflicted]) {
      statuses.set(change.path, change.status)
    }
    statusesBySummary.set(summary, statuses)
  }
  return statuses
}

/** A file's own status, or for a directory the most important status of anything inside it. */
export function pathStatus(statuses: Map<string, string>, path: string, isDirectory: boolean): string | undefined {
  if (!isDirectory) return statuses.get(path)
  const prefix = `${path}/`
  let best: string | undefined
  for (const [changed, status] of statuses) {
    if (changed.startsWith(prefix) && (best === undefined || precedence.indexOf(status) < precedence.indexOf(best))) {
      best = status
    }
  }
  return best
}
