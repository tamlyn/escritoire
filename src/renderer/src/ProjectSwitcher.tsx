import { FolderIcon, FolderOpenIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { hasModifier, modifierLabel } from './shortcuts'

type Props = {
  state: AppState
  open: boolean
  onOpenChange: (open: boolean) => void
  onActivate: (id: string) => void
  onOpenPath: (path: string) => Promise<void>
  onClose: (id: string) => void
  onRemove: (id: string) => void
}

/**
 * Keyboard palette for switching projects. Typing a path (starting with / or ~)
 * turns it into a directory picker for opening a new project.
 */
export function ProjectSwitcher(props: Props) {
  const { state, open, onOpenChange } = props
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isPath = query.startsWith('/') || query.startsWith('~')
  const completions = useDirectoryCompletions(isPath ? query : null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setError(null)
    }
  }, [open])

  const projects = orderProjects(state)

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
        <DialogTitle className="sr-only">Switch project</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a project, or type a path to open a new one
        </DialogDescription>
        <Command
          shouldFilter={!isPath}
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
            placeholder="Switch project, or type a path to open one…"
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
                <CommandEmpty>No matching projects. Type a path to open one.</CommandEmpty>
                <CommandGroup>
                  {projects.map((project) => (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      isActive={project.id === state.activeProjectId}
                      onSelect={() => {
                        props.onActivate(project.id)
                        onOpenChange(false)
                      }}
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="text-muted-foreground flex gap-4 border-t px-3 py-2 text-xs">
            {isPath ? (
              <span>Tab to complete · Enter to open</span>
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

function ProjectItem(props: { project: Project; isActive: boolean; onSelect: () => void }) {
  const { project, isActive } = props
  return (
    <CommandItem value={project.path} keywords={[project.name]} onSelect={props.onSelect}>
      <span className={project.isOpen ? '' : 'text-muted-foreground'}>{project.name}</span>
      <span className="text-muted-foreground truncate text-xs">{project.path}</span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
        {isActive ? 'current' : project.isOpen ? '' : 'closed'}
      </span>
    </CommandItem>
  )
}

/** Most recently active first, with the current project last since switching to it does nothing. */
function orderProjects(state: AppState): Project[] {
  const byRecency = [...state.projects].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const current = byRecency.filter((p) => p.id === state.activeProjectId)
  return [...byRecency.filter((p) => p.id !== state.activeProjectId), ...current]
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
