import { getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge'
import { ChangeSet, Compartment, EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import { baseName } from '../../../shared/files'
import type { GitDiffRequest } from '../../../shared/git'
import { editorTheme, loadLanguage, minimalChange } from '../file/editor'
import { useProject } from '../project-context'
import { Centred, createFileTab, type TabData } from '../tabs'
import { useGitDiff } from './git'

/** One file's staged or unstaged change, kept current as the file or index changes. */
export function DiffTab({ path, staged, from }: GitDiffRequest) {
  const project = useProject()
  const diff = useGitDiff(project.id, { path, staged, from })
  const workspace = useParentWorkspace<TabData>()

  return (
    <div className="flex h-full flex-col">
      <div className="bg-chrome flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="truncate font-mono" title={from ? `${path} (from ${from})` : path}>
          {from ? `${from} → ${path}` : path}
        </span>
        <span className="text-muted-foreground shrink-0">{staged ? 'Staged' : 'Not staged'}</span>
        <button
          type="button"
          onClick={() => workspace?.addTab(createFileTab(path))}
          className="text-muted-foreground hover:bg-accent hover:text-foreground ml-auto shrink-0 rounded px-2 py-0.5"
        >
          Open file
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {diff?.kind === 'binary' ? (
          <Centred>{path} is a binary file.</Centred>
        ) : diff?.kind === 'tooLarge' ? (
          <Centred>{path} is too large to compare.</Centred>
        ) : diff?.kind === 'text' && diff.before === diff.after ? (
          <Centred>{from ? 'Renamed, with no changes to its content.' : 'No changes.'}</Centred>
        ) : diff?.kind === 'text' ? (
          <UnifiedDiff path={path} before={diff.before} after={diff.after} />
        ) : null}
      </div>
    </div>
  )
}

function UnifiedDiff({ path, before, after }: { path: string; before: string; after: string }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const original = normalize(before)
  const changed = normalize(after)

  useEffect(() => {
    const language = new Compartment()
    const view = new EditorView({
      parent: parentRef.current!,
      state: EditorState.create({
        doc: changed,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers(),
          language.of([]),
          editorTheme(),
          unifiedMergeView({ original, mergeControls: false, collapseUnchanged: {} }),
        ],
      }),
    })
    viewRef.current = view
    loadLanguage(view, language, baseName(path))
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [path])

  // Updated in place, so the scroll position survives the file changing.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const oldOriginal = getOriginalDoc(view.state).toString()
    const oldChanged = view.state.doc.toString()
    if (oldOriginal === original && oldChanged === changed) return
    view.dispatch({
      changes: minimalChange(oldChanged, changed),
      effects:
        oldOriginal === original
          ? []
          : originalDocChangeEffect(view.state, ChangeSet.of(minimalChange(oldOriginal, original), oldOriginal.length)),
    })
  }, [original, changed])

  return <div ref={parentRef} className="h-full" />
}

/** CodeMirror joins lines with \n, so both sides are compared that way. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}
