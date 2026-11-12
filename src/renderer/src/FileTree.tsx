import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import type { DirectoryEntry } from '../../shared/files'
import { useDirectory, useRecentlyChanged } from './files'
import { useProject } from './project-context'

const indentPx = 12

/** The active project's files, loaded a directory at a time as they're expanded. */
export function FileTree({ onOpenFile }: { onOpenFile: (path: string) => void }) {
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
      <Directory path="" depth={0} expanded={expanded} onToggle={toggle} onOpenFile={onOpenFile} />
    </div>
  )
}

type DirectoryProps = {
  path: string
  depth: number
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
}

function Directory({ path, depth, ...rest }: DirectoryProps) {
  const project = useProject()
  const entries = useDirectory(project.id, path)
  if (!entries) return null
  return entries.map((entry) => <Entry key={entry.path} entry={entry} depth={depth} {...rest} />)
}

function Entry({ entry, depth, expanded, onToggle, onOpenFile }: { entry: DirectoryEntry } & Omit<DirectoryProps, 'path'>) {
  const project = useProject()
  const changed = useRecentlyChanged(project.id, entry.path)
  const isExpanded = entry.isDirectory && expanded.has(entry.path)

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        title={changed ? `${entry.path} (changed just now)` : entry.path}
        onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpenFile(entry.path))}
        style={{ paddingLeft: 8 + depth * indentPx }}
        className={`hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-1 py-0.5 pr-2 text-left outline-none ${
          changed ? 'text-amber-600 dark:text-amber-400' : ''
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
        {changed && <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-current" />}
      </button>
      {isExpanded && (
        <Directory
          path={entry.path}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  )
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
