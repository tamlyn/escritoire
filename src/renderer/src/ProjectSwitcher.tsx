import { FileIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AppState, Project } from '../../shared/api'
import { api } from './api'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { fuzzyFinder } from './fuzzy'
import { hasModifier, modifierLabel } from './shortcuts'

const projectLimit = 5
const fileLimit = 50
// Distinguishes a file's item from a project's, whose value is its absolute path.
const filePrefix = 'file:'

type Props = {
  state: AppState
  open: boolean
  onOpenChange: (open: boolean) => void
  onActivate: (id: string) => void
  onOpenPath: (path: string) => Promise<void>
  onOpenFile: (path: string) => void
  onClose: (id: string) => void
  onRemove: (id: string) => void
}

/**
 * Keyboard palette for switching projects and opening the active project's files.
 * Typing a path (starting with / or ~) turns it into a directory picker for
 * opening a new project.
 */
export function ProjectSwitcher(props: Props) {
  const { state, open, onOpenChange } = props
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isPath = query.startsWith('/') || query.startsWith('~')
  const completions = useDirectoryCompletions(isPath ? query : null)
  const files = useProjectFiles(open ? state.activeProjectId : null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setError(null)
    }
  }, [open])

  const projects = useMemo(() => orderProjects(state), [state])
  const findProjects = useMemo(() => fuzzyFinder(projects, { path: (p) => p.path, limit: projectLimit }), [projects])
  const findFiles = useMemo(() => fuzzyFinder(files, { path: (path) => path, limit: fileLimit }), [files])
  const projectMatches = query ? findProjects(query) : projects.map((item) => ({ item, positions: new Set<number>() }))
  const fileMatches = query ? findFiles(query) : []
  const isFileHighlighted = highlighted.startsWith(filePrefix)

  async function openPath(path: string) {
    try {
      await props.onOpenPath(path)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '\w+': /, '') : String(e))
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (isPath && event.key === 'Tab' && highlighted) {
      event.preventDefault()
      setQuery(`${highlighted}/`)
      return
    }
    if (isPath || !hasModifier(event)) return
    const project = state.projects.find((p) => p.path === highlighted)
    if (!project) return
    if (event.key === 'w') {
      event.preventDefault()
      props.onClose(project.id)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      props.onRemove(project.id)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Switch project or open a file</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a project or a file in this one, or type a path to open a new project
        </DialogDescription>
        <Command
          shouldFilter={false}
          value={highlighted}
          onValueChange={setHighlighted}
          onKeyDown={onKeyDown}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium"
        >
          <CommandInput
            value={query}
            onValueChange={(value) => {
              setQuery(value)
              setError(null)
            }}
            placeholder="Switch project, open a file, or type a path…"
          />
          {error && <div className="text-destructive border-b px-3 py-2">{error}</div>}
          <CommandList className="max-h-[400px]">
            {isPath ? (
              <CommandGroup>
                {query.endsWith('/') && (
                  <CommandItem value={query.slice(0, -1)} onSelect={() => void openPath(query)}>
                    <FolderOpenIcon />
                    Open {query}
                  </CommandItem>
                )}
                {completions.map((path) => (
                  <CommandItem key={path} value={path} onSelect={() => void openPath(path)}>
                    <FolderIcon />
                    {path}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <>
                <CommandEmpty>No matching projects or files. Type a path to open a project.</CommandEmpty>
                {projectMatches.length > 0 && (
                  <CommandGroup heading={query ? 'Projects' : undefined}>
                    {projectMatches.map(({ item: project, positions }) => (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        positions={positions}
                        isActive={project.id === state.activeProjectId}
                        onSelect={() => {
                          props.onActivate(project.id)
                          onOpenChange(false)
                        }}
                      />
                    ))}
                  </CommandGroup>
                )}
                {fileMatches.length > 0 && (
                  <CommandGroup heading="Files">
                    {fileMatches.map(({ item: path, positions }) => (
                      <CommandItem
                        key={path}
                        value={filePrefix + path}
                        onSelect={() => {
                          props.onOpenFile(path)
                          onOpenChange(false)
                        }}
                      >
                        <FileIcon />
                        <span className="truncate">
                          <Highlighted text={path} positions={positions} />
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
          <div className="text-muted-foreground flex gap-4 border-t px-3 py-2 text-xs">
            {isPath ? (
              <span>Tab to complete · Enter to open</span>
            ) : isFileHighlighted ? (
              <span>Enter to open</span>
            ) : (
              <>
                <span>Enter to switch</span>
                <span>{modifierLabel}W to close</span>
                <span>{modifierLabel}⌫ to remove from list</span>
              </>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function ProjectItem(props: { project: Project; positions: Set<number>; isActive: boolean; onSelect: () => void }) {
  const { project, isActive } = props
  return (
    <CommandItem value={project.path} onSelect={props.onSelect}>
      <span className={project.isOpen ? '' : 'text-muted-foreground'}>{project.name}</span>
      <span className="text-muted-foreground truncate text-xs">
        <Highlighted text={project.path} positions={props.positions} />
      </span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
        {isActive ? 'current' : project.isOpen ? '' : 'closed'}
      </span>
    </CommandItem>
  )
}

/** The text with the characters at the given positions emphasised. */
function Highlighted({ text, positions }: { text: string; positions: Set<number> }) {
  if (positions.size === 0) return text
  // Runs of matched and unmatched characters, by code point as fzf counts them.
  const runs: { text: string; matched: boolean }[] = []
  ;[...text].forEach((char, index) => {
    const matched = positions.has(index)
    const last = runs.at(-1)
    if (last?.matched === matched) last.text += char
    else runs.push({ text: char, matched })
  })
  return runs.map((run, index) =>
    run.matched ? (
      <mark key={index} className="bg-foreground text-background rounded-[2px]">
        {run.text}
      </mark>
    ) : (
      <span key={index}>{run.text}</span>
    ),
  )
}

/** Most recently active first, with the current project last since switching to it does nothing. */
function orderProjects(state: AppState): Project[] {
  const byRecency = [...state.projects].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const current = byRecency.filter((p) => p.id === state.activeProjectId)
  return [...byRecency.filter((p) => p.id !== state.activeProjectId), ...current]
}

/** Listed afresh each time the palette opens, so files an agent has just created appear. */
function useProjectFiles(projectId: string | null): string[] {
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    if (projectId === null) return setFiles([])
    let cancelled = false
    api.listProjectFiles(projectId).then(
      (result) => !cancelled && setFiles(result),
      (error) => console.error('Could not list the project files:', error),
    )
    return () => {
      cancelled = true
    }
  }, [projectId])
  return files
}

function useDirectoryCompletions(partialPath: string | null): string[] {
  const [completions, setCompletions] = useState<string[]>([])
  useEffect(() => {
    if (partialPath === null) return
    let cancelled = false
    void api.completeDirectory(partialPath).then((result) => {
      if (!cancelled) setCompletions(result)
    })
    return () => {
      cancelled = true
    }
  }, [partialPath])
  return partialPath === null ? [] : completions
}
