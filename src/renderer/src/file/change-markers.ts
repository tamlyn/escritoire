import { Chunk } from '@codemirror/merge'
import { type EditorState, type Extension, RangeSet, StateEffect, StateField, Text } from '@codemirror/state'
import { type EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from '@codemirror/view'

// Git activity comes in bursts, such as an agent's commits.
const reloadDelayMs = 500

type Kind = 'added' | 'modified' | 'deleted'

/** The file as last committed, or `null` when there's nothing to compare with. */
const setBase = StateEffect.define<Text | null>()

type Changes = { base: Text | null; chunks: readonly Chunk[] }

const changes = StateField.define<Changes>({
  create: () => ({ base: null, chunks: [] }),
  update: (value, tr) => {
    const base = tr.effects.findLast((e) => e.is(setBase))
    if (base) return { base: base.value, chunks: base.value ? Chunk.build(base.value, tr.state.doc) : [] }
    if (!tr.docChanged || !value.base) return value
    return { base: value.base, chunks: Chunk.updateB(value.chunks, value.base, tr.state.doc, tr.changes) }
  },
})

/** Each chunk's kind and the lines it covers in the document; a deletion covers the line after it. */
function changedLines(state: EditorState, chunk: Chunk): { kind: Kind; from: number; to: number; atEnd: boolean } {
  const { doc } = state
  if (chunk.fromB === chunk.toB) {
    const atEnd = chunk.fromB > doc.length
    const line = doc.lineAt(Math.min(chunk.fromB, doc.length)).number
    return { kind: 'deleted', from: line, to: line, atEnd }
  }
  return {
    kind: chunk.fromA === chunk.toA ? 'added' : 'modified',
    from: doc.lineAt(chunk.fromB).number,
    to: doc.lineAt(chunk.endB).number,
    atEnd: false,
  }
}

class ChangeMarker extends GutterMarker {
  constructor(readonly className: string) {
    super()
  }

  override eq(other: ChangeMarker): boolean {
    return other.className === this.className
  }

  override toDOM(): Node {
    const marker = document.createElement('div')
    marker.className = this.className
    return marker
  }
}

const markers = StateField.define<RangeSet<ChangeMarker>>({
  create: () => RangeSet.empty,
  update: (value, tr) => {
    if (tr.state.field(changes) === tr.startState.field(changes)) return value
    const { doc } = tr.state
    const ranges = []
    for (const chunk of tr.state.field(changes).chunks) {
      const { kind, from, to, atEnd } = changedLines(tr.state, chunk)
      const marker = new ChangeMarker(`cm-change cm-change-${kind}${atEnd ? ' cm-change-at-end' : ''}`)
      for (let line = from; line <= to; line++) ranges.push(marker.range(doc.line(line).from))
    }
    return RangeSet.of(ranges, true)
  },
})

/** The changes beside the scrollbar, placed by where they fall in the document. */
const scrollbarMarkers = ViewPlugin.fromClass(
  class {
    readonly dom: HTMLElement

    constructor(readonly view: EditorView) {
      this.dom = view.dom.appendChild(document.createElement('div'))
      this.dom.className = 'cm-change-scrollbar'
      this.dom.setAttribute('aria-hidden', 'true')
      this.draw()
    }

    update(update: ViewUpdate) {
      if (update.heightChanged || update.geometryChanged || update.state.field(changes) !== update.startState.field(changes)) {
        this.draw()
      }
    }

    draw() {
      // Placed as a fraction of the scroll height, which is the viewport's when the document is shorter.
      this.view.requestMeasure({
        key: this,
        read: (view) => view.scrollDOM.scrollHeight,
        write: (scrollHeight, view) => {
          const { state } = view
          const offset = view.documentPadding.top
          const fragment = document.createDocumentFragment()
          for (const chunk of state.field(changes).chunks) {
            const { kind, from, to, atEnd } = changedLines(state, chunk)
            const first = view.lineBlockAt(state.doc.line(from).from)
            const last = view.lineBlockAt(state.doc.line(to).from)
            const top = kind === 'deleted' && atEnd ? last.bottom : first.top
            const height = kind === 'deleted' ? 0 : last.bottom - first.top
            const mark = fragment.appendChild(document.createElement('div'))
            mark.className = `cm-change-${kind}`
            mark.style.top = `${((top + offset) / scrollHeight) * 100}%`
            mark.style.height = `${(height / scrollHeight) * 100}%`
          }
          this.dom.replaceChildren(fragment)
        },
      })
    }

    destroy() {
      this.dom.remove()
    }
  },
)

type Options = {
  /** The file as last committed, `null` if git doesn't track it. */
  load: () => Promise<string | null>
  /** Calls the listener when git's state may have changed, such as after a commit; returns an unsubscribe. */
  onGitChanged: (listener: () => void) => () => void
}

/** Lines added, modified or deleted since the last commit, in the gutter and beside the scrollbar, as in IntelliJ. */
export function changeMarkers({ load, onGitChanged }: Options): Extension {
  const loader = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let latest = 0
    let loaded: string | null | undefined
    const reload = () => {
      const request = ++latest
      void load().then(
        (text) => {
          if (request !== latest || text === loaded) return
          loaded = text
          // The editor's lines are split the same way, whatever the file's line endings.
          view.dispatch({ effects: setBase.of(text === null ? null : Text.of(text.split(/\r\n?|\n/))) })
        },
        (error: unknown) => console.error(error),
      )
    }
    reload()
    const unsubscribe = onGitChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(reload, reloadDelayMs)
    })
    return {
      destroy: () => {
        clearTimeout(timer)
        latest++
        unsubscribe()
      },
    }
  })

  return [
    changes,
    markers,
    loader,
    scrollbarMarkers,
    gutter({
      class: 'cm-change-gutter',
      markers: (view) => view.state.field(markers),
    }),
  ]
}
