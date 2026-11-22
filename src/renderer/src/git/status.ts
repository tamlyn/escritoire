import { parentPath } from '../../../shared/files'
import type { GitSummary } from '../../../shared/git'

const modified = 'text-git-modified'
const added = 'text-git-added'

/**
 * Text colours for the letters `git status` shows, plus ! for ignored. JetBrains'
 * Islands Light and Islands Dark colours, except ignored files, which recede.
 */
export const statusColours: Record<string, string> = {
  M: modified,
  T: modified,
  R: modified,
  C: added,
  A: added,
  '?': 'text-git-untracked',
  '!': 'text-muted-foreground',
  D: 'text-muted-foreground',
  U: 'text-git-conflicted',
}

export const statusNames: Record<string, string> = {
  M: 'modified',
  T: 'type changed',
  A: 'added',
  '?': 'untracked',
  '!': 'ignored',
  D: 'deleted',
  U: 'conflicted',
  R: 'renamed',
  C: 'copied',
}

// Most important first: a directory shows the first that anything inside it has.
const precedence = ['U', 'D', 'M', 'T', 'R', 'C', 'A', '?']

const statusesBySummary = new WeakMap<GitSummary, Map<string, string>>()

/** One status per changed or ignored path: a conflict, else its unstaged change, else its staged one. */
export function fileStatuses(summary: GitSummary): Map<string, string> {
  let statuses = statusesBySummary.get(summary)
  if (!statuses) {
    statuses = new Map(summary.ignored.map((path) => [path, '!']))
    for (const change of [...summary.untracked, ...summary.staged, ...summary.unstaged, ...summary.conflicted]) {
      statuses.set(change.path, change.status)
    }
    statusesBySummary.set(summary, statuses)
  }
  return statuses
}

/**
 * A path's own status, else ignored if it's inside an ignored directory, else for a
 * directory the most important change inside it. Ignored files don't mark their directory.
 */
export function pathStatus(statuses: Map<string, string>, path: string, isDirectory: boolean): string | undefined {
  const own = statuses.get(path)
  if (own !== undefined) return own
  for (let parent = parentPath(path); parent !== ''; parent = parentPath(parent)) {
    if (statuses.get(parent) === '!') return '!'
  }
  if (!isDirectory) return undefined
  const prefix = `${path}/`
  let best: string | undefined
  for (const [changed, status] of statuses) {
    if (
      status !== '!' &&
      changed.startsWith(prefix) &&
      (best === undefined || precedence.indexOf(status) < precedence.indexOf(best))
    ) {
      best = status
    }
  }
  return best
}
