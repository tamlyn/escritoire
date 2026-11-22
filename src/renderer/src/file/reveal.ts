import { EditorView } from '@codemirror/view'

/** A line from 1, and optionally what to select in it, as offsets into the line. */
type Reveal = { line: number; from?: number; to?: number }

/**
 * Lines asked for by a file link or search result, by project and path. Held until the file's
 * editor takes it, since the tab may not exist yet or still be loading.
 */
const pending = new Map<string, Reveal>()
const listeners = new Set<(key: string) => void>()

const keyOf = (projectId: string, path: string) => `${projectId}\n${path}`

export function revealLine(projectId: string, path: string, line: number, columns?: { from: number; to: number }): void {
  const key = keyOf(projectId, path)
  pending.set(key, { line, ...columns })
  for (const listener of listeners) listener(key)
}

/** Moves the editor to the lines asked for, now and whenever asked again. */
export function followReveals(view: EditorView, projectId: string, path: string): () => void {
  const key = keyOf(projectId, path)
  const reveal = () => {
    const request = pending.get(key)
    if (!request) return
    pending.delete(key)
    const { doc } = view.state
    const target = doc.line(Math.min(Math.max(request.line, 1), doc.lines))
    const column = (offset = 0) => target.from + Math.min(offset, target.length)
    const anchor = column(request.from)
    view.dispatch({ selection: { anchor, head: column(request.to ?? request.from) }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
    view.focus()
  }
  reveal()
  const listener = (revealed: string) => revealed === key && reveal()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
