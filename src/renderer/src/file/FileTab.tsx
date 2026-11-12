import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import { baseName } from '../../../shared/files'
import { api } from '../api'
import { useFileContent } from '../files'
import { useProject } from '../project-context'
import { Centred, type Tab, type TabData } from '../tabs'
import { editorTheme, loadLanguage, minimalChange } from './editor'

const saveDelayMs = 500
const scrollSaveDelayMs = 500

export function FileTab({ tab, path, scrollPos }: { tab: Tab; path: string; scrollPos?: number }) {
  const project = useProject()
  const content = useFileContent(project.id, path)
  const workspace = useParentWorkspace<TabData>()

  if (!content) return null
  switch (content.kind) {
    case 'missing':
      return <Centred>{path} doesn't exist.</Centred>
    case 'binary':
      return <Centred>{path} is a binary file.</Centred>
    case 'tooLarge':
      return <Centred>{path} is too large to open ({(content.size / 1024 / 1024).toFixed(1)} MB).</Centred>
    case 'text':
      return (
        <Editor
          projectId={project.id}
          path={path}
          content={content}
          initialScrollPos={scrollPos}
          onScrolled={(pos) => workspace?.updateTab(tab.id, { data: { kind: 'file', path, scrollPos: pos } })}
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
}

/**
 * Edits autosave shortly after typing stops, on blur and on close; there's no
 * manual save. Changes made on disk apply in place unless an edit is about to
 * be saved, in which case the edit wins.
 */
function Editor({ projectId, path, content, initialScrollPos, onScrolled }: EditorProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const unsaved = useRef<string | null>(null)
  const onScrolledRef = useRef(onScrolled)
  onScrolledRef.current = onScrolled

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let scrollTimer: ReturnType<typeof setTimeout> | undefined

    const save = () => {
      clearTimeout(saveTimer)
      if (unsaved.current === null) return
      const text = unsaved.current
      unsaved.current = null
      void api.writeFile(projectId, path, text)
    }

    const language = new Compartment()
    const view = new EditorView({
      parent: parentRef.current!,
      state: EditorState.create({
        doc: content.text,
        extensions: [
          basicSetup,
          language.of([]),
          editorTheme(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.every((tr) => tr.annotation(fromDisk))) return
            unsaved.current = update.state.doc.toString()
            clearTimeout(saveTimer)
            saveTimer = setTimeout(save, saveDelayMs)
          }),
          EditorView.domEventHandlers({
            blur: save,
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
    window.addEventListener('beforeunload', save)

    return () => {
      window.removeEventListener('beforeunload', save)
      clearTimeout(scrollTimer)
      save()
      view.destroy()
      viewRef.current = null
    }
  }, [projectId, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view || unsaved.current !== null) return
    const current = view.state.doc.toString()
    if (current === content.text) return
    view.dispatch({ changes: minimalChange(current, content.text), annotations: fromDisk.of(true) })
  }, [content])

  return <div ref={parentRef} className="h-full" />
}
