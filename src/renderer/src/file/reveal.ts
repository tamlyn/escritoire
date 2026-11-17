import { EditorView } from '@codemirror/view'

/**
 * Lines asked for by a file link, by project and path. Held until the file's
 * editor takes it, since the tab may not exist yet or still be loading.
 */
const pending = new Map<string, number>()
const listeners = new Set<(key: string) => void>()

const keyOf = (projectId: string, path: string) => `${projectId}\n${path}`

export function revealLine(projectId: string, path: string, line: number): void {
  const key = keyOf(projectId, path)
  pending.set(key, line)
  for (const listener of listeners) listener(key)
}

/** Moves the editor to the lines asked for, now and whenever asked again. */
export function followReveals(view: EditorView, projectId: string, path: string): () => void {
  const key = keyOf(projectId, path)
  const reveal = () => {
    const line = pending.get(key)
    if (line === undefined) return
    pending.delete(key)
    const { doc } = view.state
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines))
    view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
    view.focus()
  }
  reveal()
  const listener = (revealed: string) => revealed === key && reveal()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
