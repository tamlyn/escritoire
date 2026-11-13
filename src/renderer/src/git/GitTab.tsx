import { GitBranchIcon } from 'lucide-react'
import { useParentWorkspace } from 'react-resizable-panels'
import { baseName, parentPath } from '../../../shared/files'
import type { GitChange, GitCommit, GitSummary } from '../../../shared/git'
import { relativeTime } from '../lib/time'
import { useProject } from '../project-context'
import { Centred, createDiffTab, type TabData } from '../tabs'
import { useGitSummary } from './git'

/** The project's changes and recent commits: a summary, not a review tool. */
export function GitTab() {
  const project = useProject()
  const summary = useGitSummary(project.id)
  const workspace = useParentWorkspace<TabData>()

  if (summary === undefined) return null
  if (summary === null) return <Centred>{project.name} isn't in a git repository.</Centred>

  const open = (change: GitChange, staged: boolean) =>
    workspace?.addTab(createDiffTab({ path: change.path, staged, ...(change.from ? { from: change.from } : {}) }))
  const clean =
    summary.conflicted.length + summary.staged.length + summary.unstaged.length + summary.untracked.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6 text-sm">
        <BranchHeader summary={summary} />
        {clean && <p className="text-muted-foreground">No changes.</p>}
        <ChangeGroup title="Conflicts" changes={summary.conflicted} onOpen={(c) => open(c, false)} />
        <ChangeGroup title="Staged" changes={summary.staged} onOpen={(c) => open(c, true)} />
        <ChangeGroup title="Changes" changes={summary.unstaged} onOpen={(c) => open(c, false)} />
        <ChangeGroup
          title="Untracked"
          changes={summary.untracked}
          omitted={summary.untrackedOmitted}
          onOpen={(c) => open(c, false)}
        />
        {summary.commits.length > 0 && <History commits={summary.commits} />}
      </div>
    </div>
  )
}

function BranchHeader({ summary }: { summary: GitSummary }) {
  const { upstream } = summary
  return (
    <header className="flex items-baseline gap-2">
      <GitBranchIcon className="text-muted-foreground size-4 shrink-0 self-center" />
      <h1 className="font-medium">{summary.branch ?? 'Detached HEAD'}</h1>
      {upstream && (
        <span className="text-muted-foreground text-xs">
          {upstream.name}
          {upstream.ahead > 0 && <span title={`${upstream.ahead} to push`}> ↑{upstream.ahead}</span>}
          {upstream.behind > 0 && <span title={`${upstream.behind} to pull`}> ↓{upstream.behind}</span>}
        </span>
      )}
    </header>
  )
}

const statusColours: Record<string, string> = {
  M: 'text-amber-500',
  T: 'text-amber-500',
  A: 'text-green-500',
  '?': 'text-green-500',
  D: 'text-red-500',
  U: 'text-red-500',
  R: 'text-blue-500',
  C: 'text-blue-500',
}

function ChangeGroup({
  title,
  changes,
  omitted = 0,
  onOpen,
}: {
  title: string
  changes: GitChange[]
  omitted?: number
  onOpen: (change: GitChange) => void
}) {
  if (changes.length === 0) return null
  return (
    <section aria-label={title}>
      <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">
        {title} <span className="tabular-nums">{changes.length + omitted}</span>
      </h2>
      <ul>
        {changes.map((change) => (
          <li key={change.path}>
            <button
              type="button"
              onClick={() => onOpen(change)}
              title={change.from ? `${change.path} (from ${change.from})` : change.path}
              className="hover:bg-accent focus-visible:bg-accent flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left outline-none"
            >
              <span className={`w-3 shrink-0 font-mono text-xs ${statusColours[change.status] ?? ''}`}>
                {change.status}
              </span>
              <span className="shrink-0">{baseName(change.path)}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{parentPath(change.path)}</span>
              <LineCounts lines={change.lines} />
            </button>
          </li>
        ))}
      </ul>
      {omitted > 0 && <p className="text-muted-foreground px-2 py-1 text-xs">and {omitted} more</p>}
    </section>
  )
}

function LineCounts({ lines }: { lines: GitChange['lines'] }) {
  if (lines === null) return null
  if (lines === 'binary') return <span className="text-muted-foreground shrink-0 text-xs">binary</span>
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      {lines.added > 0 && <span className="text-green-500">+{lines.added}</span>}
      {lines.added > 0 && lines.removed > 0 && ' '}
      {lines.removed > 0 && <span className="text-red-500">−{lines.removed}</span>}
    </span>
  )
}

function History({ commits }: { commits: GitCommit[] }) {
  return (
    <section aria-label="History">
      <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">History</h2>
      <ul>
        {commits.map((commit) => (
          <li key={commit.hash} className="flex items-baseline gap-2 px-2 py-1" title={commit.hash}>
            <span className="min-w-0 flex-1 truncate">
              {commit.subject}
              {commit.refs.map((ref) => (
                <span key={ref} className="bg-muted text-muted-foreground ml-2 rounded px-1.5 py-0.5 text-xs">
                  {ref.replace(/^HEAD -> /, '')}
                </span>
              ))}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">{commit.author}</span>
            <span className="text-muted-foreground w-24 shrink-0 text-right text-xs">{relativeTime(commit.at)}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs">{commit.shortHash}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
