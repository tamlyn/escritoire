import { GitBranchIcon } from 'lucide-react'
import { useProject } from '../project-context'
import { changedFileCount, useGitSummary } from './git'

/** The branch and how many files changed, at the foot of the sidebar; opens the Git tab. */
export function GitStatusRow({ onOpen }: { onOpen: () => void }) {
  const project = useProject()
  const summary = useGitSummary(project.id)
  if (!summary) return null
  const count = changedFileCount(summary)
  const upstream = summary.upstream

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Show changes and history"
      className="hover:bg-accent flex shrink-0 items-center gap-2 border-t px-3 py-2 text-left text-sm"
    >
      <GitBranchIcon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{summary.branch ?? 'Detached HEAD'}</span>
      {upstream && (upstream.ahead > 0 || upstream.behind > 0) && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {upstream.ahead > 0 && `↑${upstream.ahead}`}
          {upstream.ahead > 0 && upstream.behind > 0 && ' '}
          {upstream.behind > 0 && `↓${upstream.behind}`}
        </span>
      )}
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
        {count === 0 ? 'No changes' : count === 1 ? '1 file changed' : `${count} files changed`}
      </span>
    </button>
  )
}
