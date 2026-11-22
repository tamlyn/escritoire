import { ChevronRightIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { type DirectoryEntry, parentPath } from '../../shared/files'
import type { GitChange, GitDiffRequest, GitSummary } from '../../shared/git'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './components/ui/context-menu'
import { useFileActions } from './file-actions'
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
  /** Without it, as on the phone, which has no diff view, changes aren't offered. */
  onOpenDiff?: (request: GitDiffRequest) => void
}) {
  const project = useProject()
  const actions = useFileActions()
  const menu = useMenuActions()
  const [expanded, setExpanded] = useState(() => loadExpanded(project.id))

  function toggle(path: string) {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
    saveExpanded(project.id, next)
  }

  // Right-clicking below the files creates one at the root.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div role="tree" aria-label="Files" className="text-ui h-full overflow-auto py-1 select-none">
          <Directory
            path=""
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ContextMenuItem onSelect={menu.after(() => actions.newFile(''))}>New file…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

type DirectoryProps = {
  path: string
  depth: number
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onOpenDiff?: (request: GitDiffRequest) => void
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
  const actions = useFileActions()
  const menu = useMenuActions()
  const summary = useGitSummary(project.id)
  const status = summary ? pathStatus(fileStatuses(summary), entry.path, entry.isDirectory) : undefined
  const hasChanges = entry.isDirectory && status !== undefined && status !== '!'
  const isExpanded = entry.isDirectory && expanded.has(entry.path)
  const diffs = onOpenDiff && summary && !entry.isDirectory ? fileDiffs(summary, entry.path) : []

  const row = (
    <button
      type="button"
      role="treeitem"
      aria-expanded={entry.isDirectory ? isExpanded : undefined}
      title={
        status === undefined
          ? entry.path
          : `${entry.path} (${hasChanges ? 'has changes' : (statusNames[status] ?? 'changed')})`
      }
      onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpenFile(entry.path))}
      style={{ paddingLeft: 8 + depth * indentPx }}
      className={`hover:bg-accent focus-visible:bg-selected data-[state=open]:bg-selected flex h-[26px] w-full items-center gap-1 pr-2.5 text-left outline-none compact:h-11 compact:text-[15px] ${
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
      {hasChanges && (
        <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-current" />
      )}
    </button>
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={menu.onCloseAutoFocus}>
          {diffs.map((request) => (
            <ContextMenuItem key={String(request.staged)} onSelect={() => onOpenDiff?.(request)}>
              {request.staged ? 'View staged changes' : 'View changes'}
            </ContextMenuItem>
          ))}
          {diffs.length > 0 && <ContextMenuSeparator />}
          <ContextMenuItem
            onSelect={menu.after(() => actions.newFile(entry.isDirectory ? entry.path : parentPath(entry.path)))}
          >
            New file…
          </ContextMenuItem>
          <ContextMenuItem onSelect={menu.after(() => actions.rename(entry))}>Rename…</ContextMenuItem>
          <ContextMenuItem onSelect={menu.after(() => actions.remove(entry))}>Move to Trash</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
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

/**
 * Defers an item's action until the menu has gone. A dialog opened sooner has
 * its focus taken by the closing menu and given back with all its input selected.
 */
function useMenuActions() {
  const pending = useRef<(() => void) | null>(null)
  return {
    after: (action: () => void) => () => {
      pending.current = action
    },
    onCloseAutoFocus: (event: Event) => {
      const action = pending.current
      pending.current = null
      if (!action) return
      event.preventDefault()
      action()
    },
  }
}
