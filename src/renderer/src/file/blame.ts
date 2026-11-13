import { type EditorState, type Extension, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { GutterMarker, gutter, ViewPlugin } from '@codemirror/view'
import type { GitBlame } from '../../../shared/git'

// Edits and git activity come in bursts, such as typing or an agent's commits.
const reloadDelayMs = 500
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' })

const setBlame = StateEffect.define<GitBlame | null>()

type Commit = GitBlame['commits'][string]

class BlameMarker extends GutterMarker {
  constructor(
    readonly hash: string,
    readonly commit: Commit,
  ) {
    super()
  }

  override eq(other: BlameMarker): boolean {
    return other.hash === this.hash
  }

  override toDOM(): Node {
    const marker = document.createElement('div')
    marker.className = 'cm-blame'
    marker.textContent = `${dateFormat.format(this.commit.at)} ${this.commit.author}`
    marker.title = `${this.commit.subject}\n${this.commit.author}, ${new Date(this.commit.at).toLocaleString()}\n${this.commit.shortHash}: click to show the commit`
    return marker
  }
}

/** A marker on the first line of each run of lines last changed by the same commit. */
function markersFor(state: EditorState, blame: GitBlame | null): RangeSet<BlameMarker> {
  if (!blame) return RangeSet.empty
  const markers = []
  let previous: string | null = null
  for (let i = 0; i < Math.min(blame.lines.length, state.doc.lines); i++) {
    const hash = blame.lines[i] ?? null
    const commit = hash ? blame.commits[hash] : undefined
    if (hash && commit && hash !== previous) markers.push(new BlameMarker(hash, commit).range(state.doc.line(i + 1).from))
    previous = hash
  }
  return RangeSet.of(markers)
}

const blameMarkers = StateField.define<RangeSet<BlameMarker>>({
  create: () => RangeSet.empty,
  update: (markers, tr) => {
    const blame = tr.effects.findLast((e) => e.is(setBlame))
    if (blame) return markersFor(tr.state, blame.value)
    // Until the edited text is blamed again.
    return tr.docChanged ? markers.map(tr.changes) : markers
  },
})

type Options = {
  /** Blames the given text, the document as it is now. */
  load: (text: string) => Promise<GitBlame | null>
  /** Calls the listener when git's state may have changed, such as after a commit; returns an unsubscribe. */
  onGitChanged: (listener: () => void) => () => void
  onOpenCommit: (commit: { hash: string; shortHash: string }) => void
}

/** Who last changed each line, beside the line numbers. Blames the document being edited, so lines stay aligned. */
export function blameGutter({ load, onGitChanged, onOpenCommit }: Options): Extension {
  const loader = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let latest = 0
    const reload = () => {
      const request = ++latest
      const doc = view.state.doc
      void load(view.state.sliceDoc()).then(
        (blame) => {
          // A newer request, or an edit since, makes this one stale.
          if (request === latest && view.state.doc === doc) view.dispatch({ effects: setBlame.of(blame) })
        },
        (error: unknown) => console.error(error),
      )
    }
    const scheduleReload = () => {
      clearTimeout(timer)
      timer = setTimeout(reload, reloadDelayMs)
    }
    reload()
    const unsubscribe = onGitChanged(scheduleReload)
    return {
      update: (update) => {
        if (update.docChanged) scheduleReload()
      },
      destroy: () => {
        clearTimeout(timer)
        latest++
        unsubscribe()
      },
    }
  })

  return [
    blameMarkers,
    loader,
    gutter({
      class: 'cm-blame-gutter',
      markers: (view) => view.state.field(blameMarkers),
      domEventHandlers: {
        mousedown: (view, line) => {
          let marker: BlameMarker | undefined
          view.state.field(blameMarkers).between(line.from, line.from, (_from, _to, value) => {
            marker = value
          })
          if (!marker) return false
          onOpenCommit({ hash: marker.hash, shortHash: marker.commit.shortHash })
          return true
        },
      },
    }),
  ]
}
