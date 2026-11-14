import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import { baseName } from '../../../shared/files'
import { isTaskFile } from '../../../shared/process'
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { api, flushers, subscribe } from '../api'
import { useFileContent } from '../files'
import { useProcesses } from '../processes'
import { useProject } from '../project-context'
import { Centred, createCommitTab, createProcessTab, type Tab, type TabData } from '../tabs'
import { blameGutter } from './blame'
import { changeMarkers } from './change-markers'
import { changeFromDisk, editorTheme, loadLanguage } from './editor'
import { runGutter, setRunningTasks } from './run-gutter'

const saveDelayMs = 500
// The scroll position lives in the project layout, which is rewritten on every save.
const scrollSaveDelayMs = 1500

type FileTabData = Extract<TabData, { kind: 'file' }>

export function FileTab({ tab, data }: { tab: Tab; data: FileTabData }) {
  const { path, scrollPos, blame = false } = data
  const project = useProject()
  const content = useFileContent(project.id, path)
  const workspace = useParentWorkspace<TabData>()
  const processes = useProcesses(project.id)
  const runningTasks = useMemo(
    () => processes.filter((p) => p.status === 'running' && p.task?.file === path).map((p) => p.task!.name),
    [processes, path],
  )

  async function runTask(name: string) {
    const process = await api.startProcess(project.id, { task: { file: path, name } })
    workspace?.addTab(createProcessTab(process))
  }

  if (!content) return null
  switch (content.kind) {
    case 'missing':
      return <Centred>{path} doesn't exist.</Centred>
    case 'binary':
      return <Centred>{path} is a binary file.</Centred>
    case 'notUtf8':
      return <Centred>{path} isn't UTF-8 text, so it can't be edited here.</Centred>
    case 'tooLarge':
      return <Centred>{path} is too large to open ({(content.size / 1024 / 1024).toFixed(1)} MB).</Centred>
    case 'text':
      return (
        <Editor
          projectId={project.id}
          path={path}
          content={content}
          initialScrollPos={scrollPos}
          onScrolled={(pos) => workspace?.updateTab(tab.id, { data: { ...data, scrollPos: pos } })}
          onRunTask={(name) => void runTask(name)}
          runningTasks={runningTasks}
          blame={blame}
          onBlameChange={(on) => workspace?.updateTab(tab.id, { data: { ...data, blame: on } })}
          onOpenCommit={(commit) => workspace?.addTab(createCommitTab(commit))}
        />
      )
  }
}

// Marks transactions that apply a change made on disk, which mustn't be saved back.
const fromDisk = Annotation.define<boolean>()

type EditorProps = {
  projectId: string
  path: string
  /** A new object whenever the file is read, even if its text is unchanged. */
  content: { text: string }
  initialScrollPos: number | undefined
  onScrolled: (pos: number) => void
  onRunTask: (name: string) => void
  runningTasks: string[]
  blame: boolean
  onBlameChange: (on: boolean) => void
  onOpenCommit: (commit: { hash: string; shortHash: string }) => void
}

/**
 * Edits autosave shortly after typing stops, on blur and on close; there's no
 * manual save. Changes made on disk apply in place unless an edit is waiting
 * to be saved or is being saved, in which case the edit wins.
 */
function Editor({
  projectId,
  path,
  content,
  initialScrollPos,
  onScrolled,
  onRunTask,
  runningTasks,
  blame,
  onBlameChange,
  onOpenCommit,
}: EditorProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const unsaved = useRef<string | null>(null)
  const writing = useRef(0)
  const baseline = useRef(content.text)
  const [diskContent, setDiskContent] = useState(content)
  const [saveError, setSaveError] = useState<string | null>(null)
  const onScrolledRef = useRef(onScrolled)
  onScrolledRef.current = onScrolled
  const onRunTaskRef = useRef(onRunTask)
  onRunTaskRef.current = onRunTask
  const onOpenCommitRef = useRef(onOpenCommit)
  onOpenCommitRef.current = onOpenCommit
  const blameCompartment = useRef(new Compartment()).current

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let scrollTimer: ReturnType<typeof setTimeout> | undefined

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
    const view = new EditorView({
      parent: parentRef.current!,
      state: EditorState.create({
        doc: content.text,
        extensions: [
          // CodeMirror splits on any line ending and joins with \n unless told
          // otherwise, which would rewrite every line of a CRLF file on save.
          content.text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : [],
          // Configured by the effect below.
          blameCompartment.of([]),
          isTaskFile(baseName(path)) ? runGutter(baseName(path), (name) => onRunTaskRef.current(name)) : [],
          basicSetup,
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
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.every((tr) => tr.annotation(fromDisk))) return
            // sliceDoc rather than doc.toString, which always joins lines with \n.
            unsaved.current = update.state.sliceDoc()
            clearTimeout(saveTimer)
            saveTimer = setTimeout(save, saveDelayMs)
          }),
          EditorView.domEventHandlers({
            blur: () => { void save() },
            scroll: (_event, view) => {
              clearTimeout(scrollTimer)
              scrollTimer = setTimeout(() => {
                onScrolledRef.current(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from)
              }, scrollSaveDelayMs)
            },
          }),
        ],
      }),
      scrollTo:
        initialScrollPos === undefined
          ? undefined
          : EditorView.scrollIntoView(Math.min(initialScrollPos, content.text.length), { y: 'start' }),
    })
    viewRef.current = view
    loadLanguage(view, language, baseName(path))


    return () => {
      flushers.delete(flush)
      clearTimeout(scrollTimer)
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
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
