import { Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { LoaderCircleIcon, PlayIcon, SquareIcon } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { type Connection, connectionForFile, statementsToRun } from '../../../../shared/sql'
import { useProject } from '../../project-context'
import { modifierLabel } from '../../shortcuts'
import { cancelSql, runSql, useConnections, useSqlRun } from '../../sql'
import type { EditorProps } from '../FileEditor'
import { ConnectionDialog } from './ConnectionDialog'
import { ConnectionPicker } from './ConnectionPicker'
import { Results } from './Results'

type SqlFileProps = {
  path: string
  renderEditor: (props: Pick<EditorProps, 'extensions' | 'viewRef'>) => ReactNode
}

/** A SQL file's editor, with a connection to run its statements on and their results below. */
export function SqlFile({ path, renderEditor }: SqlFileProps) {
  const projectId = useProject().id
  const state = useConnections(projectId)
  const connection = state && connectionForFile(state, path)
  const run = useSqlRun(projectId, path)
  const viewRef = useRef<EditorView>(null)
  // `null` for a new connection.
  const [editing, setEditing] = useState<Connection | null | undefined>(undefined)
  const [hint, setHint] = useState<string | null>(null)

  function execute() {
    const view = viewRef.current
    if (!view || !state || run?.running) return
    if (!connection) {
      if (state.connections.length === 0) setEditing(null)
      else setHint('Choose a connection to run on')
      return
    }
    setHint(null)
    // Document offsets count line breaks as one character, as `toString` joins them.
    const text = view.state.doc.toString()
    const { from, to } = view.state.selection.main
    const statements = statementsToRun(text, from, to).map((s) => text.slice(s.from, s.to))
    if (statements.length > 0) void runSql(projectId, path, connection.id, statements)
  }
  const executeRef = useRef(execute)
  executeRef.current = execute
  const extensions = useMemo(
    // Above the default keymap, where Mod-Enter inserts a blank line.
    () => Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => (executeRef.current(), true) }])),
    [],
  )
  const editor = renderEditor({ viewRef, extensions })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm">
        {state && (
          <ConnectionPicker
            path={path}
            state={state}
            current={connection}
            onEdit={(c) => setEditing(c)}
            onChosen={() => setHint(null)}
          />
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
        <div className="ml-auto">
          {run?.running ? (
            <Button variant="ghost" size="sm" onClick={() => cancelSql(run)}>
              <SquareIcon />
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" title={`Run the statement at the cursor, or those selected (${modifierLabel}↵)`} onClick={execute}>
              <PlayIcon />
              Run
            </Button>
          )}
        </div>
      </div>
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel id="editor" minSize={60}>
          {editor}
        </Panel>
        {run && (
          <>
            <Separator className="bg-border h-px data-[separator=active]:bg-ring data-[separator=hover]:bg-ring" />
            <Panel id="results" defaultSize="40" minSize={60}>
              {run.running ? (
                <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  Running…
                </div>
              ) : (
                <Results key={run.runId} run={run} />
              )}
            </Panel>
          </>
        )}
      </Group>
      {editing !== undefined && (
        <ConnectionDialog path={path} connection={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
