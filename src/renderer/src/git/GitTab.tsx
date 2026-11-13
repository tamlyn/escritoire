import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, GitBranchIcon, LoaderCircleIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import type { GitBranch, GitChange, GitCommit, GitHistory, GitSummary } from '../../../shared/git'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '../api'
import { relativeTime } from '../lib/time'
import { useProject } from '../project-context'
import { Centred, createCommitTab, createDiffTab, type TabData } from '../tabs'
import { ChangeGroup } from './ChangeGroup'
import { errorMessage, useGitHistory, useGitSummary } from './git'
import { type GraphRow, layoutGraph } from './graph'
import { RefLabels } from './RefLabels'

/** The project's changes, branches and history. */
export function GitTab() {
  const project = useProject()
  const summary = useGitSummary(project.id)
  const history = useGitHistory(project.id)
  const workspace = useParentWorkspace<TabData>()

  if (summary === undefined) return null
  if (summary === null) return <Centred>{project.name} isn't in a git repository.</Centred>

  const open = (change: GitChange, staged: boolean) =>
    workspace?.addTab(createDiffTab({ path: change.path, staged, ...(change.from ? { from: change.from } : {}) }))
  const clean =
    summary.conflicted.length + summary.staged.length + summary.unstaged.length + summary.untracked.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6 text-sm">
        <BranchHeader summary={summary} history={history ?? null} />
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
        {history && history.commits.length > 0 && (
          <History commits={history.commits} onOpen={(commit) => workspace?.addTab(createCommitTab(commit))} />
        )}
      </div>
    </div>
  )
}

type Operation = 'switch' | 'pull' | 'push'

function BranchHeader({ summary, history }: { summary: GitSummary; history: GitHistory | null }) {
  const project = useProject()
  const [running, setRunning] = useState<Operation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { upstream } = summary

  async function run(operation: Operation, action: () => Promise<void>) {
    setRunning(operation)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setRunning(null)
    }
  }

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <BranchMenu
          current={summary.branch}
          branches={history?.branches ?? []}
          disabled={running !== null}
          onSwitch={(branch) => void run('switch', () => api.switchGitBranch(project.id, branch))}
        />
        {upstream && (
          <span className="text-muted-foreground text-xs">
            {upstream.name}
            {upstream.ahead > 0 && <span title={`${upstream.ahead} to push`}> ↑{upstream.ahead}</span>}
            {upstream.behind > 0 && <span title={`${upstream.behind} to pull`}> ↓{upstream.behind}</span>}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={running !== null || !upstream}
            title={upstream ? `Pull from ${upstream.name}` : 'This branch has no upstream to pull from'}
            onClick={() => void run('pull', () => api.pullGit(project.id))}
          >
            {running === 'pull' ? <LoaderCircleIcon className="animate-spin" /> : <ArrowDownIcon />}
            Pull
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={running !== null || !summary.branch}
            title={upstream ? `Push to ${upstream.name}` : 'Push to origin, and track it'}
            onClick={() => void run('push', () => api.pushGit(project.id))}
          >
            {running === 'push' ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
            Push
          </Button>
        </div>
      </div>
      {error && (
        <pre role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
          {error}
        </pre>
      )}
    </header>
  )
}

function BranchMenu({
  current,
  branches,
  disabled,
  onSwitch,
}: {
  current: string | null
  branches: GitBranch[]
  disabled: boolean
  onSwitch: (branch: GitBranch) => void
}) {
  const local = branches.filter((b) => b.kind === 'local')
  const remote = branches.filter((b) => b.kind === 'remote')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="ghost" size="sm" className="-ml-2.5 font-medium" title="Switch branch">
          <GitBranchIcon className="text-muted-foreground" />
          {current ?? 'Detached HEAD'}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-56">
        {local.map((branch) => (
          <DropdownMenuItem key={branch.name} disabled={branch.current} onSelect={() => onSwitch(branch)}>
            <CheckIcon className={branch.current ? '' : 'invisible'} />
            {branch.name}
          </DropdownMenuItem>
        ))}
        {remote.length > 0 && (
          <>
            {local.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Remote</DropdownMenuLabel>
            {remote.map((branch) => (
              <DropdownMenuItem key={branch.name} onSelect={() => onSwitch(branch)}>
                <CheckIcon className="invisible" />
                {branch.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const laneWidth = 14
const rowHeight = 28
// Tailwind's 500 shades, as literals: Tailwind only emits the variables its classes use.
const laneColours = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4', '#f97316', '#ec4899']

function History({ commits, onOpen }: { commits: GitCommit[]; onOpen: (commit: GitCommit) => void }) {
  const graph = useMemo(() => layoutGraph(commits), [commits])
  return (
    <section aria-label="History">
      <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">History</h2>
      <ul>
        {commits.map((commit, index) => (
          <li key={commit.hash}>
            <button
              type="button"
              onClick={() => onOpen(commit)}
              title={commit.hash}
              style={{ height: rowHeight }}
              className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-md px-2 text-left outline-none"
            >
              <GraphCell row={graph.rows[index]!} width={graph.width} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <RefLabels refs={commit.refs} />
                <span className="truncate">{commit.subject}</span>
              </span>
              <span className="text-muted-foreground max-w-32 shrink-0 truncate text-xs">{commit.author}</span>
              <span className="text-muted-foreground w-24 shrink-0 text-right text-xs">{relativeTime(commit.at)}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">{commit.shortHash}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => (lane + 0.5) * laneWidth
  const y = (position: number) => position * rowHeight
  return (
    <svg aria-hidden width={width * laneWidth} height={rowHeight} className="shrink-0 overflow-visible">
      {row.lines.map((line, i) => {
        const [x1, y1, x2, y2] = [x(line.x1), y(line.y1), x(line.x2), y(line.y2)]
        // Curves where a line changes lane, joined vertically at both ends.
        const middle = (y1 + y2) / 2
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`
        return <path key={i} d={d} fill="none" strokeWidth={1.5} stroke={laneColours[line.colour % laneColours.length]} />
      })}
      <circle
        cx={x(row.lane)}
        cy={y(0.5)}
        r={3.5}
        fill="var(--background)"
        strokeWidth={2}
        stroke={laneColours[row.colour % laneColours.length]}
      />
    </svg>
  )
}
