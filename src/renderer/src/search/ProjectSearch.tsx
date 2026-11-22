import { EditorState, type Extension, Compartment, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  ViewPlugin,
} from '@codemirror/view'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { baseName } from '../../../shared/files'
import { escapeRegExp, findRanges, type LineMatch, queryRegExp, type SearchResults, type TextQuery } from '../../../shared/search'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '../api'
import { editorTheme, loadLanguage } from '../file/editor'
import { useFileContent } from '../files'
import { QueryToggles, toggledOption } from './QueryToggles'

const searchDelayMs = 150

export type SearchResult = { path: string; match: LineMatch }

// Kept between openings, as WebStorm does.
let lastQuery: TextQuery = { text: '', caseSensitive: false, wholeWord: false, regexp: false }

type Props = {
  projectId: string
  open: boolean
  /** Text to search for instead of the last query's, such as the editor's selection. */
  seed: string | null
  onOpenChange: (open: boolean) => void
  onOpenResult: (result: SearchResult) => void
}

/** Searches the text of the project's files, previewing the highlighted match. */
export function ProjectSearch({ projectId, open, seed, onOpenChange, onOpenResult }: Props) {
  const [query, setQuery] = useState(lastQuery)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [highlighted, setHighlighted] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const chosen = useRef<SearchResult | null>(null)
  const regexp = useMemo(() => queryRegExp(query), [query])

  useEffect(() => {
    if (!open) return setResults(null)
    if (seed !== null) setQuery({ ...lastQuery, text: lastQuery.regexp ? escapeRegExp(seed) : seed })
  }, [open])

  useEffect(() => {
    lastQuery = query
    if (!open || !regexp) return setSearching(false)
    setSearching(true)
    let current = true
    const timer = setTimeout(() => {
      api.searchProject(projectId, query).then(
        (found) => {
          if (!current || !found) return
          setResults(found)
          setSearching(false)
        },
        (error: unknown) => {
          console.error('Could not search the project:', error)
          if (current) setSearching(false)
        },
      )
    }, searchDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, projectId, query, regexp])

  const rows = useMemo(
    () =>
      regexp && results
        ? results.files.flatMap(({ path, lines }) => lines.map((match) => ({ value: `${path}:${match.line}`, path, match })))
        : [],
    [results, regexp],
  )
  // cmdk keeps the value of an item that has gone, so fall back to the first.
  const selected = rows.find((row) => row.value === highlighted) ?? rows[0]
  const fileCount = new Set(rows.map((row) => row.path)).size
  const more = results?.truncated ? '+' : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[8%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[min(1000px,calc(100%-4rem))]"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
        onCloseAutoFocus={(event) => {
          // Once the dialog has let go of focus, so the opened editor keeps it.
          const result = chosen.current
          chosen.current = null
          if (!result) return
          event.preventDefault()
          onOpenResult(result)
        }}
      >
        <DialogTitle className="sr-only">Find in files</DialogTitle>
        <DialogDescription className="sr-only">Search the text of this project's files</DialogDescription>
        <Command
          shouldFilter={false}
          disablePointerSelection
          value={selected?.value ?? ''}
          onValueChange={setHighlighted}
          onKeyDown={(event) => {
            const option = toggledOption(event)
            if (!option) return
            event.preventDefault()
            setQuery({ ...query, [option]: !query[option] })
          }}
          className="h-[min(760px,84vh)]"
        >
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b pr-2 pl-4">
            <SearchIcon className="text-muted-foreground size-4.5 shrink-0" />
            <CommandPrimitive.Input
              ref={inputRef}
              value={query.text}
              onValueChange={(text) => setQuery({ ...query, text })}
              placeholder="Find in files…"
              spellCheck={false}
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-hidden"
            />
            <QueryToggles options={query} onToggle={(option) => setQuery({ ...query, [option]: !query[option] })} />
          </div>
          <CommandList className="max-h-none min-h-0 flex-2 p-1">
            {!query.text ? (
              <Message>Type to search the project's files.</Message>
            ) : !regexp ? (
              <Message>Not a valid regular expression.</Message>
            ) : results && rows.length === 0 ? (
              <Message>No matches.</Message>
            ) : (
              rows.map(({ value, path, match }) => (
                <CommandItem
                  key={value}
                  value={value}
                  title={`${path}:${match.line}`}
                  onSelect={() => {
                    chosen.current = { path, match }
                    onOpenChange(false)
                  }}
                  className="hover:bg-accent min-h-7 gap-4 py-0.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] whitespace-pre">
                    <Highlighted text={match.preview} ranges={match.ranges} />
                  </span>
                  <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">
                    {baseName(path)} <span className="tabular-nums">{match.line}</span>
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
          <div className="flex min-h-0 flex-3 flex-col border-t">
            {selected && (
              <>
                <div className="bg-chrome text-muted-foreground truncate border-b px-3 py-1 font-mono text-xs">{selected.path}</div>
                <Preview projectId={projectId} path={selected.path} match={selected.match} regexp={regexp} />
              </>
            )}
          </div>
          <div className="bg-chrome text-muted-foreground flex items-center gap-x-5 border-t px-4 py-2 text-xs">
            <span className="tabular-nums">
              {searching
                ? 'Searching…'
                : rows.length > 0 &&
                  `${rows.length}${more} matching ${rows.length === 1 && !more ? 'line' : 'lines'} in ${fileCount}${more} ${fileCount === 1 && !more ? 'file' : 'files'}`}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <kbd className="bg-background text-foreground inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border px-1 font-sans text-[11px]">
                ↵
              </kbd>
              Open
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Message({ children }: { children: string }) {
  return <div className="text-muted-foreground px-4 py-6 text-center">{children}</div>
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [from, to] of ranges) {
    parts.push(text.slice(at, from))
    parts.push(
      <mark key={from} className="in-data-[selected=true]:bg-primary-foreground/25 rounded-[2px] bg-[var(--search-match)] text-inherit">
        {text.slice(from, to)}
      </mark>,
    )
    at = to
  }
  parts.push(text.slice(at))
  return parts
}

/** The file around the match, read-only, with every match in it highlighted. */
function Preview({ projectId, path, match, regexp }: { projectId: string; path: string; match: LineMatch; regexp: RegExp | null }) {
  const content = useFileContent(projectId, path)
  if (!content) return null
  if (content.kind !== 'text') return <Message>Can't preview this file.</Message>
  return <PreviewEditor path={path} text={content.text} match={match} regexp={regexp} />
}

function PreviewEditor({ path, text, match, regexp }: { path: string; text: string; match: LineMatch; regexp: RegExp | null }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const highlights = useRef(new Compartment()).current

  useEffect(() => {
    const language = new Compartment()
    const view = new EditorView({
      parent: parentRef.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          language.of([]),
          highlights.of(matchHighlights(regexp)),
          editorTheme(),
        ],
      }),
    })
    viewRef.current = view
    loadLanguage(view, language, baseName(path))
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [path, text])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: highlights.reconfigure(matchHighlights(regexp)) })
  }, [regexp])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const { doc } = view.state
    const line = doc.line(Math.min(match.line, doc.lines))
    view.dispatch({
      selection: { anchor: line.from + Math.min(match.from, line.length), head: line.from + Math.min(match.to, line.length) },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
  }, [path, text, match])

  return <div ref={parentRef} className="min-h-0 flex-1" />
}

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })

/** Marks matches in the visible lines; CodeMirror's MatchDecorator would loop on an empty match. */
function matchHighlights(regexp: RegExp | null): Extension {
  if (!regexp) return []
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos)
        for (const [start, end] of findRanges(line.text, regexp)) builder.add(line.from + start, line.from + end, matchMark)
        pos = line.to + 1
      }
    }
    return builder.finish()
  }
  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(update) {
        if (update.viewportChanged || update.docChanged) this.decorations = build(update.view)
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  )
}

/** The editor's selection, if it is something to search for: on one line and not too long. */
export function selectedEditorText(): string | null {
  const editor = document.activeElement?.closest<HTMLElement>('.cm-editor')
  const view = editor && EditorView.findFromDOM(editor)
  if (!view) return null
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  return text && !text.includes('\n') && text.length <= 200 ? text : null
}
