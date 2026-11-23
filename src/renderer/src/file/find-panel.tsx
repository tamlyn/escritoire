import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import { type EditorState, type Extension, Prec, StateEffect, StateField, type Text } from '@codemirror/state'
import { type Command, EditorView, keymap, type Panel, runScopeHandlers, type ViewUpdate } from '@codemirror/view'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type QueryOptions, QueryToggles, toggledOption } from '../search/QueryToggles'
import { hasModifier, modifierLabel } from '../shortcuts'

type QueryConfig = ConstructorParameters<typeof SearchQuery>[0]

// Counting stops here, so a common word in a huge file doesn't slow typing.
const maxCounted = 1000
// Counting scans the document, so while it's edited the count waits for a pause.
const recountDelayMs = 300

const showReplace = StateEffect.define<boolean>()
const replaceShown = StateField.define<boolean>({
  create: () => false,
  update: (shown, transaction) => transaction.effects.reduce((value, effect) => (effect.is(showReplace) ? effect.value : value), shown),
})

/** Opens the find bar, with or without its replace row, as WebStorm's ⌘F and ⌘R do. */
const openFind =
  (replace: boolean): Command =>
  (view) => {
    openSearchPanel(view)
    view.dispatch({ effects: showReplace.of(replace) })
    return true
  }

/** CodeMirror's search, with a find bar in the app's style. */
export function findPanel(): Extension {
  return [
    // Literal, so a backslash means itself as it does in project search.
    search({ top: true, literal: true, createPanel: (view) => new FindPanel(view) }),
    replaceShown,
    // Ahead of basicSetup's search keys, from the editor or the bar.
    Prec.high(
      keymap.of([
        { key: 'Mod-f', run: openFind(false), scope: 'editor search-panel', preventDefault: true },
        { key: 'Mod-r', run: openFind(true), scope: 'editor search-panel', preventDefault: true },
      ]),
    ),
  ]
}

/** A React root inside CodeMirror's panel, re-rendered with each new editor state. */
class FindPanel implements Panel {
  readonly dom = document.createElement('div')
  readonly top = true
  private readonly root = createRoot(this.dom)
  private readonly listeners = new Set<() => void>()
  private state: EditorState

  constructor(view: EditorView) {
    this.state = view.state
    // Rendered now, so the field exists for CodeMirror to focus as the panel mounts.
    flushSync(() => this.root.render(<FindBar view={view} subscribe={this.subscribe} getState={this.getState} />))
  }

  mount() {
    this.dom.querySelector<HTMLInputElement>('[main-field]')?.select()
  }

  update(update: ViewUpdate) {
    if (update.state === this.state) return
    this.state = update.state
    for (const listener of this.listeners) listener()
  }

  destroy() {
    // The editor may be destroyed while React is rendering, which can't unmount a root synchronously.
    queueMicrotask(() => this.root.unmount())
  }

  private readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readonly getState = () => this.state
}

type Props = { view: EditorView; subscribe: (listener: () => void) => () => void; getState: () => EditorState }

function FindBar({ view, subscribe, getState }: Props) {
  const state = useSyncExternalStore(subscribe, getState)
  const query = getSearchQuery(state)
  const replacing = state.field(replaceShown)
  const doc = useSettled(state.doc, recountDelayMs)
  const matches = useMemo(() => findMatches(doc, query), [doc, query])
  const { main } = state.selection
  const current = matches.findIndex((match) => match.from === main.from && match.to === main.to)

  function change(config: Partial<QueryConfig>) {
    const { search, caseSensitive, literal, regexp, replace, wholeWord } = query
    const next = new SearchQuery({ search, caseSensitive, literal, regexp, replace, wholeWord, ...config })
    // As you type, select the first match from where the selection starts.
    const match = 'replace' in config || !next.valid ? null : firstMatch(view.state, next, main.from)
    view.dispatch({
      effects: [setSearchQuery.of(next), ...(match ? [EditorView.scrollIntoView(match.from, { y: 'center' })] : [])],
      selection: match ? { anchor: match.from, head: match.to } : undefined,
      userEvent: 'select.search',
    })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, onEnter: (event: React.KeyboardEvent) => void) {
    const option = toggledOption(event)
    if (option) {
      event.preventDefault()
      change({ [option]: !query[option] })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onEnter(event)
    } else if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) {
      event.preventDefault()
    }
  }

  const status = !query.search
    ? ''
    : !query.valid
      ? 'Invalid regex'
      : matches.length === 0
        ? 'No results'
        : `${current >= 0 ? `${current + 1}/` : ''}${matches.length}${matches.length === maxCounted ? '+' : ''}${current >= 0 ? '' : ' results'}`
  const failed = query.search !== '' && (!query.valid || matches.length === 0)

  return (
    <div className="text-ui flex items-start gap-1 px-1.5 py-1.5 font-sans">
      <IconButton label={replacing ? 'Hide replace' : 'Show replace'} onClick={() => view.dispatch({ effects: showReplace.of(!replacing) })}>
        <ChevronRightIcon className={cn('transition-transform', replacing && 'rotate-90')} />
      </IconButton>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex items-center gap-1">
          <Field failed={failed}>
            <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
            <input
              {...{ 'main-field': 'true' }}
              aria-label="Find"
              placeholder="Find"
              spellCheck={false}
              value={query.search}
              onChange={(event) => change({ search: event.target.value })}
              onKeyDown={(event) => onKeyDown(event, ({ shiftKey }) => (shiftKey ? findPrevious : findNext)(view))}
              className="min-w-0 flex-1 bg-transparent font-mono outline-none"
            />
            <QueryToggles options={query as QueryOptions} onToggle={(option) => change({ [option]: !query[option] })} />
          </Field>
          <span className={cn('w-20 shrink-0 px-1.5 text-xs tabular-nums', failed ? 'text-destructive' : 'text-muted-foreground')}>
            {status}
          </span>
          <IconButton label="Previous match (⇧↵)" onClick={() => findPrevious(view)}>
            <ArrowUpIcon />
          </IconButton>
          <IconButton label="Next match (↵)" onClick={() => findNext(view)}>
            <ArrowDownIcon />
          </IconButton>
        </div>
        {replacing && (
          <div className="flex items-center gap-1">
            <Field>
              <input
                aria-label="Replace"
                placeholder="Replace"
                spellCheck={false}
                value={query.replace}
                onChange={(event) => change({ replace: event.target.value })}
                onKeyDown={(event) => onKeyDown(event, (enter) => (hasModifier(enter) ? replaceAll : replaceNext)(view))}
                className="ml-5 min-w-0 flex-1 bg-transparent font-mono outline-none"
              />
            </Field>
            <Button variant="ghost" size="xs" className="ml-1.5" title="Replace (↵)" onClick={() => replaceNext(view)}>
              Replace
            </Button>
            <Button variant="ghost" size="xs" title={`Replace all (${modifierLabel}↵)`} onClick={() => replaceAll(view)}>
              Replace all
            </Button>
          </div>
        )}
      </div>
      <IconButton label="Close (Esc)" onClick={() => closeSearchPanel(view)}>
        <XIcon />
      </IconButton>
    </div>
  )
}

/** The first match at or after `from`, wrapping round to the start. */
function firstMatch(state: EditorState, query: SearchQuery, from: number): { from: number; to: number } | null {
  const after = query.getCursor(state, from).next()
  if (!after.done) return after.value
  const any = query.getCursor(state).next()
  return any.done ? null : any.value
}

function findMatches(doc: Text, query: SearchQuery): { from: number; to: number }[] {
  if (!query.valid) return []
  const matches: { from: number; to: number }[] = []
  const cursor = query.getCursor(doc)
  for (let next = cursor.next(); !next.done && matches.length < maxCounted; next = cursor.next()) matches.push(next.value)
  return matches
}

/** The value once it has stayed the same for `delayMs`. */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

function Field({ failed = false, children }: { failed?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'bg-background focus-within:border-ring focus-within:ring-ring/30 flex h-7 max-w-[480px] flex-1 items-center gap-1.5 rounded-md border pr-0.5 pl-2 focus-within:ring-2',
        failed && 'border-destructive/60 focus-within:border-destructive/60 focus-within:ring-destructive/20',
      )}
    >
      {children}
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon-xs" title={label} aria-label={label} onClick={onClick} className="text-muted-foreground hover:text-foreground size-7 [&_svg:not([class*='size-'])]:size-4">
      {children}
    </Button>
  )
}
