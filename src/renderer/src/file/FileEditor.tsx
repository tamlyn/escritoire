import { Annotation, Compartment, EditorState, type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { baseName } from '../../../shared/files'
import { isTaskFile } from '../../../shared/process'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { CopyPathItems } from '../CopyPathItems'
import { api, flushers, subscribe } from '../api'
import { runCommandKey } from '../commands'
import { blameGutter } from './blame'
import { changeMarkers } from './change-markers'
import { changeFromDisk, editorTheme, loadLanguage } from './editor'
import { findPanel } from './find-panel'
import { followReveals } from './reveal'
import { runGutter, setRunningTasks } from './run-gutter'

const saveDelayMs = 500
// The position lives in the project layout, which is rewritten on every save.
const positionSaveDelayMs = 1500

// Marks transactions that apply a change made on disk, which mustn't be saved back.
const fromDisk = Annotation.define<boolean>()

/** Where the user is in a file, as document positions. */
export type EditorPosition = {
  /** The start of the top line. */
  scrollPos: number
  cursor: number
}

export type EditorProps = {
  projectId: string
  path: string
  /** A new object whenever the file is read, even if its text is unchanged. */
  content: { text: string }
  initialPosition: Partial<EditorPosition>
  onPositionChanged: (position: EditorPosition) => void
  /** Without it, a task file offers no way to run its tasks. */
  onRunTask?: (name: string) => void
  runningTasks: string[]
  blame: boolean
  onBlameChange: (on: boolean) => void
  onOpenCommit: (commit: { hash: string; shortHash: string }) => void
  /** Added when the editor is created; later changes are ignored. */
  extensions?: Extension
  /** Set to the editor's view while it exists. */
  viewRef?: RefObject<EditorView | null>
}

/**
 * Edits autosave shortly after typing stops, on blur and on close; there's no
 * manual save. Changes made on disk apply in place unless an edit is waiting
 * to be saved or is being saved, in which case the edit wins.
 */
export function Editor({
  projectId,
  path,
  content,
  initialPosition,
  onPositionChanged,
  onRunTask,
  runningTasks,
  blame,
  onBlameChange,
  onOpenCommit,
  extensions = [],
  viewRef: externalViewRef,
}: EditorProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const ownViewRef = useRef<EditorView>(null)
  const viewRef = externalViewRef ?? ownViewRef
  const unsaved = useRef<string | null>(null)
  const writing = useRef(0)
  const baseline = useRef(content.text)
  const [diskContent, setDiskContent] = useState(content)
  const [saveError, setSaveError] = useState<string | null>(null)
  const onPositionChangedRef = useRef(onPositionChanged)
  onPositionChangedRef.current = onPositionChanged
  const onRunTaskRef = useRef(onRunTask)
  onRunTaskRef.current = onRunTask
  const onOpenCommitRef = useRef(onOpenCommit)
  onOpenCommitRef.current = onOpenCommit
  const blameCompartment = useRef(new Compartment()).current

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let positionTimer: ReturnType<typeof setTimeout> | undefined
    const positionChanged = (view: EditorView) => {
      clearTimeout(positionTimer)
      positionTimer = setTimeout(() => {
        onPositionChangedRef.current({
          scrollPos: view.lineBlockAtHeight(view.scrollDOM.scrollTop).from,
          cursor: view.state.selection.main.head,
        })
      }, positionSaveDelayMs)
    }

    let pending: Promise<void> = Promise.resolve()
    const save = (): Promise<void> => {
      clearTimeout(saveTimer)
      pending = pending.then(async () => {
        const text = unsaved.current
        if (text === null) return
        unsaved.current = null
        writing.current++
        try {
          await api.writeFile(projectId, path, text, baseline.current)
          baseline.current = text
          setSaveError(null)
          const latest = await api.readFile(projectId, path)
          if (latest.kind === 'text') setDiskContent(latest)
        } catch (error) {
          unsaved.current ??= text
          setSaveError(error instanceof Error ? error.message : String(error))
        } finally {
          writing.current--
        }
      })
      return pending
    }
    const flush = async () => {
      await save()
      if (unsaved.current !== null) throw new Error(`Couldn't save ${path}`)
    }
    flushers.add(flush)

    const language = new Compartment()
    const state = EditorState.create({
      doc: content.text,
      extensions: [
        // CodeMirror splits on any line ending and joins with \n unless told
        // otherwise, which would rewrite every line of a CRLF file on save.
        content.text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : [],
        // Configured by the effect below.
        blameCompartment.of([]),
        onRunTask && isTaskFile(baseName(path)) ? runGutter(baseName(path), (name) => onRunTaskRef.current?.(name)) : [],
        basicSetup,
        findPanel(),
        // The app's shortcuts before the editor's keymap, which on Linux folds code on Ctrl+Shift+[.
        Prec.highest(EditorView.domEventHandlers({ keydown: runCommandKey })),
        // After basicSetup, so its gutter sits between the line numbers and the text.
        changeMarkers({
          load: () => api.getGitHeadText(projectId, path),
          onGitChanged: (listener) =>
            subscribe('gitChanged', (event) => {
              if (event.projectId === projectId) listener()
            }),
        }),
        language.of([]),
        editorTheme(),
        extensions,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) positionChanged(update.view)
          if (!update.docChanged || update.transactions.every((tr) => tr.annotation(fromDisk))) return
          // sliceDoc rather than doc.toString, which always joins lines with \n.
          unsaved.current = update.state.sliceDoc()
          clearTimeout(saveTimer)
          saveTimer = setTimeout(save, saveDelayMs)
        }),
        EditorView.domEventHandlers({
          blur: () => { void save() },
          scroll: (_event, view) => positionChanged(view),
        }),
      ],
    })
    // The file may have shrunk since the position was saved.
    const clamp = (pos: number) => Math.min(pos, state.doc.length)
    const { scrollPos, cursor } = initialPosition
    const view = new EditorView({
      parent: parentRef.current!,
      state: cursor === undefined ? state : state.update({ selection: { anchor: clamp(cursor) } }).state,
      scrollTo: scrollPos === undefined ? undefined : EditorView.scrollIntoView(clamp(scrollPos), { y: 'start' }),
    })
    viewRef.current = view
    loadLanguage(view, language, baseName(path))
    const stopFollowing = followReveals(view, projectId, path)

    return () => {
      stopFollowing()
      flushers.delete(flush)
      clearTimeout(positionTimer)
      save()
      view.destroy()
      viewRef.current = null
    }
  }, [projectId, path])

  useEffect(() => { setDiskContent(content) }, [content])
  useEffect(() => {
    const view = viewRef.current
    if (!view || writing.current > 0) return
    if (unsaved.current !== null) {
      if (diskContent.text !== baseline.current) setSaveError('File changed on disk. Copy your edits and reopen the tab to resolve the conflict.')
      return
    }
    baseline.current = diskContent.text
    if (view.state.sliceDoc() === diskContent.text) return
    view.dispatch({ changes: changeFromDisk(view.state, diskContent.text), annotations: fromDisk.of(true) })
  }, [diskContent])

  function blameExtension() {
    return blameGutter({
      load: (text) => api.getGitBlame(projectId, path, text),
      onGitChanged: (listener) =>
        subscribe('gitChanged', (event) => {
          if (event.projectId === projectId) listener()
        }),
      onOpenCommit: (commit) => onOpenCommitRef.current(commit),
    })
  }

  useEffect(() => {
    viewRef.current?.dispatch({ effects: blameCompartment.reconfigure(blame ? blameExtension() : []) })
  }, [blame, projectId, path])

  const runningKey = runningTasks.join('\0')
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setRunningTasks.of(new Set(runningTasks)) })
  }, [runningKey])

  return (
    <div className="flex h-full flex-col">
      {saveError && (
        <div role="alert" className="bg-destructive/10 text-destructive shrink-0 px-3 py-1.5 text-sm">
          Couldn't save: {saveError}
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={parentRef} className="min-h-0 flex-1" />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem checked={blame} onCheckedChange={onBlameChange}>
            Git blame
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <CopyPathItems path={path} />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
