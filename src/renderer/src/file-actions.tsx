import { createContext, type RefObject, useContext, useRef, useState } from 'react'
import type { WorkspaceImperativeHandle, WorkspaceNode } from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { DirectoryEntry } from '../../shared/files'
import { api, errorMessage, flushers } from './api'
import { tabsetsIn } from './layout-tree'
import { isWithin, newFileTarget, normalizePath } from './new-file'
import { useProject } from './project-context'
import { reloadConnections } from './sql'
import { createFileTab, type TabData } from './tabs'

type FileActions = {
  /** Asks for a new file's path, starting in `directory`, then opens it with `open` or the provider's `openFile`. */
  newFile(directory: string, open?: (path: string) => void): void
  rename(entry: DirectoryEntry): void
  /** Moves the entry to the trash and closes its tabs. */
  remove(entry: DirectoryEntry): void
}

const FileActionsContext = createContext<FileActions | null>(null)

export function useFileActions(): FileActions {
  const actions = useContext(FileActionsContext)
  if (!actions) throw new Error('useFileActions needs a FileActionsProvider')
  return actions
}

type Workspace = WorkspaceImperativeHandle<TabData>

type Prompt =
  | { kind: 'new'; directory: string; open: (path: string) => void }
  | { kind: 'rename'; entry: DirectoryEntry }
  | { kind: 'error'; message: string }

/** Creating, renaming and deleting files, for the file tree, the new tab page and shortcuts. */
export function FileActionsProvider({
  workspaceRef,
  openFile,
  children,
}: {
  /** The tabs to keep in step with renames and deletions; the phone has none. */
  workspaceRef?: RefObject<Workspace | null>
  openFile: (path: string) => void
  children: React.ReactNode
}) {
  const project = useProject()
  const [prompt, setPrompt] = useState<Prompt | null>(null)

  const actions: FileActions = {
    newFile: (directory, open = openFile) =>
      setPrompt({ kind: 'new', directory, open }),
    rename: (entry) => setPrompt({ kind: 'rename', entry }),
    remove: (entry) => {
      void (async () => {
        try {
          // An editor's pending save would otherwise fail against the trashed file.
          await flushEditors()
          await api.deleteFile(project.id, entry.path)
          if (workspaceRef?.current) moveFileTabs(workspaceRef.current, entry.path, null)
        } catch (error) {
          setPrompt({ kind: 'error', message: errorMessage(error) })
        }
      })()
    },
  }

  async function create(input: string, open: (path: string) => void) {
    const target = newFileTarget(input)
    if (!target) return
    const path =
      target.kind === 'scratch'
        ? await api.createScratchFile(project.id, target.extension)
        : (await api.createFile(project.id, target.path), target.path)
    open(path)
  }

  async function rename(from: string, input: string) {
    const to = normalizePath(input)
    if (!to || to === from) return
    await flushEditors()
    await api.renameFile(project.id, from, to)
    if (workspaceRef?.current) moveFileTabs(workspaceRef.current, from, to)
    await reloadConnections(project.id)
  }

  const close = () => setPrompt(null)

  return (
    <FileActionsContext.Provider value={actions}>
      {children}
      {prompt?.kind === 'new' && (
        <PathPrompt
          title="New file"
          description="A path in the project, or just an extension for a scratch file."
          initial={prompt.directory ? `${prompt.directory}/` : ''}
          placeholder=".md, .sql or a path"
          submitLabel="Create"
          hint={(input) => {
            const target = newFileTarget(input)
            if (!target) return 'Type .md, .json, .sql or another extension for a scratch file, or a path with a name.'
            return target.kind === 'scratch'
              ? `Creates a scratch .${target.extension} file in .scratch/ (or type ./.${target.extension} for a file named .${target.extension})`
              : `Creates ${target.path}`
          }}
          onSubmit={(input) => create(input, prompt.open)}
          onClose={close}
        />
      )}
      {prompt?.kind === 'rename' && (
        <PathPrompt
          title={`Rename ${prompt.entry.name}`}
          description="A new name, or a path to move it to."
          initial={prompt.entry.path}
          selection={nameRange(prompt.entry)}
          submitLabel="Rename"
          hint={(input) => {
            const to = normalizePath(input)
            return to && to !== prompt.entry.path ? `Moves to ${to}` : ''
          }}
          onSubmit={(input) => rename(prompt.entry.path, input)}
          onClose={close}
        />
      )}
      {prompt?.kind === 'error' && (
        <Dialog open onOpenChange={(open) => open || close()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Couldn't move to the trash</DialogTitle>
              <DialogDescription>{prompt.message}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
    </FileActionsContext.Provider>
  )
}

function PathPrompt(props: {
  title: string
  description: string
  initial: string
  /** What to select in `initial`; defaults to placing the cursor at its end. */
  selection?: [number, number]
  placeholder?: string
  submitLabel: string
  hint: (input: string) => string
  onSubmit: (input: string) => Promise<void>
  onClose: () => void
}) {
  const [input, setInput] = useState(props.initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    setBusy(true)
    try {
      await props.onSubmit(input)
      props.onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => open || props.onClose()}>
      <DialogContent
        className="top-[20%] translate-y-0 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const element = inputRef.current
          if (!element) return
          element.focus()
          const [start, end] = props.selection ?? [props.initial.length, props.initial.length]
          element.setSelectionRange(start, end)
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input
              ref={inputRef}
              aria-label="Path"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setError(null)
              }}
              placeholder={props.placeholder}
              className="font-mono"
              spellCheck={false}
              aria-describedby="path-prompt-hint"
            />
            <span id="path-prompt-hint" className="text-muted-foreground min-h-4 text-xs">
              {props.hint(input)}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The name without its extension, so typing replaces just that. */
function nameRange(entry: DirectoryEntry): [number, number] {
  const start = entry.path.length - entry.name.length
  const dot = entry.name.lastIndexOf('.')
  return [start, start + (entry.isDirectory || dot <= 0 ? entry.name.length : dot)]
}

async function flushEditors(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()))
}

/**
 * Follows a renamed file or directory with its open file tabs, in place, or
 * closes them if it was deleted (`to` is `null`).
 */
function moveFileTabs(workspace: Workspace, from: string, to: string | null): void {
  for (const tabset of tabsetsIn(workspace.getModel())) {
    for (const tab of tabset.tabs) {
      if (tab.data.kind !== 'file' || !isWithin(tab.data.path, from)) continue
      if (to !== null) {
        const path = to + tab.data.path.slice(from.length)
        workspace.addTab(
          { ...createFileTab(path), data: { ...tab.data, path } },
          { tabsetId: tabset.id, index: tabset.tabs.indexOf(tab), select: tabset.selectedId === tab.id },
        )
      }
      workspace.closeTab(tab.id)
    }
  }
}
