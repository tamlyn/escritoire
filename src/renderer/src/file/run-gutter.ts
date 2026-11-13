import { type EditorState, type Extension, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { GutterMarker, gutter } from '@codemirror/view'
import { findTasks } from './tasks'

/** Tells the editor which of its tasks are running, to show them differently. */
export const setRunningTasks = StateEffect.define<ReadonlySet<string>>()

const runningTasks = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update: (running, tr) => tr.effects.findLast((e) => e.is(setRunningTasks))?.value ?? running,
})

class RunMarker extends GutterMarker {
  constructor(
    readonly name: string,
    readonly running: boolean,
  ) {
    super()
  }

  override eq(other: RunMarker): boolean {
    return other.name === this.name && other.running === this.running
  }

  override toDOM(): Node {
    const marker = document.createElement('div')
    marker.className = this.running ? 'cm-run-task cm-run-task-running' : 'cm-run-task'
    marker.title = this.running ? `${this.name} is running: show it` : `Run ${this.name}`
    marker.setAttribute('aria-label', marker.title)
    marker.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>'
    return marker
  }
}

/** A run icon beside each script or task the file defines, as in WebStorm. */
export function runGutter(fileName: string, onRun: (name: string) => void): Extension {
  const build = (state: EditorState) => {
    const running = state.field(runningTasks)
    const markers = findTasks(fileName, state.sliceDoc()).map((task) =>
      new RunMarker(task.name, running.has(task.name)).range(state.doc.lineAt(task.offset).from),
    )
    return RangeSet.of(markers, true)
  }
  const markers = StateField.define<RangeSet<RunMarker>>({
    create: build,
    update: (value, tr) =>
      tr.docChanged || tr.effects.some((e) => e.is(setRunningTasks)) ? build(tr.state) : value,
  })

  return [
    runningTasks,
    markers,
    gutter({
      class: 'cm-run-gutter',
      markers: (view) => view.state.field(markers),
      initialSpacer: () => new RunMarker('', false),
      domEventHandlers: {
        mousedown: (view, line) => {
          let name: string | undefined
          view.state.field(markers).between(line.from, line.from, (_from, _to, marker) => {
            name = marker.name
          })
          if (name === undefined) return false
          onRun(name)
          return true
        },
      },
    }),
  ]
}
