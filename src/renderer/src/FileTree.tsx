import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import type { DirectoryEntry } from '../../shared/files'
import type { GitChange, GitDiffRequest, GitSummary } from '../../shared/git'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './components/ui/context-menu'
import { useDirectory } from './files'
import { useGitSummary } from './git/git'
import { fileStatuses, pathStatus, statusColours, statusNames } from './git/status'
import { useProject } from './project-context'

const indentPx = 12

/** The active project's files, loaded a directory at a time as they're expanded. */
export function FileTree({
  onOpenFile,
  onOpenDiff,
}: {
  onOpenFile: (path: string) => void
  onOpenDiff: (request: GitDiffRequest) => void
}) {
  const project = useProject()
  const [expanded, setExpanded] = useState(() => loadExpanded(project.id))

  function toggle(path: string) {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
    saveExpanded(project.id, next)
  }

  return (
    <div role="tree" aria-label="Files" className="h-full overflow-auto py-1 text-sm select-none">
      <Directory
        path=""
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    </div>
  )
}

type DirectoryProps = {
  path: string
  depth: number
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onOpenDiff: (request: GitDiffRequest) => void
}

function Directory({ path, depth, ...rest }: DirectoryProps) {
  const project = useProject()
  const entries = useDirectory(project.id, path)
  if (!entries) return null
  return entries.map((entry) => <Entry key={entry.path} entry={entry} depth={depth} {...rest} />)
}

function Entry({
  entry,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: { entry: DirectoryEntry } & Omit<DirectoryProps, 'path'>) {
  const project = useProject()
  const summary = useGitSummary(project.id)
  const status = summary ? pathStatus(fileStatuses(summary), entry.path, entry.isDirectory) : undefined
  const isExpanded = entry.isDirectory && expanded.has(entry.path)
  const diffs = summary && !entry.isDirectory ? fileDiffs(summary, entry.path) : []

  const row = (
    <button
      type="button"
      role="treeitem"
      aria-expanded={entry.isDirectory ? isExpanded : undefined}
      title={
        status === undefined
          ? entry.path
          : `${entry.path} (${entry.isDirectory ? 'has changes' : (statusNames[status] ?? 'changed')})`
      }
      onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpenFile(entry.path))}
      style={{ paddingLeft: 8 + depth * indentPx }}
      className={`hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-1 py-0.5 pr-2 text-left outline-none ${
        status === undefined ? '' : (statusColours[status] ?? '')
      }`}
    >
      {entry.isDirectory ? (
        <ChevronRightIcon
          className={`text-muted-foreground size-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{entry.name}</span>
      {status !== undefined && entry.isDirectory && (
        <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-current" />
      )}
    </button>
  )

  return (
    <>
      {diffs.length === 0 ? (
        row
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            {diffs.map((request) => (
              <ContextMenuItem key={String(request.staged)} onSelect={() => onOpenDiff(request)}>
                {request.staged ? 'View staged changes' : 'View changes'}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
      )}
      {isExpanded && (
        <Directory
          path={entry.path}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      )}
    </>
  )
}

/** The file's unstaged change (including untracked and conflicted), then its staged one, as in the git tab. */
function fileDiffs(summary: GitSummary, path: string): GitDiffRequest[] {
  const request = (change: GitChange | undefined, staged: boolean) =>
    change ? [{ path, staged, ...(change.from ? { from: change.from } : {}) }] : []
  const find = (changes: GitChange[]) => changes.find((change) => change.path === path)
  return [
    ...request(find(summary.conflicted) ?? find(summary.unstaged) ?? find(summary.untracked), false),
    ...request(find(summary.staged), true),
  ]
}

// Which directories are open is a view preference, so it lives in the renderer.
function storageKey(projectId: string): string {
  return `fileTree.expanded.${projectId}`
}

function loadExpanded(projectId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey(projectId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveExpanded(projectId: string, expanded: ReadonlySet<string>): void {
  localStorage.setItem(storageKey(projectId), JSON.stringify([...expanded]))
}
