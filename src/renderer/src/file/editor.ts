import { LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Compartment, EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'

/** Colours come from the app's tokens; syntax colours are `.tok-*` rules in styles.css. */
export function editorTheme(): Extension {
  return [
    EditorView.theme(
      {
        '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55' },
        '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none' },
        '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--accent) 60%, transparent)' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
          { backgroundColor: 'color-mix(in oklch, var(--ring) 35%, transparent)' },
        '.cm-panels': { backgroundColor: 'var(--chrome)', color: 'var(--foreground)' },
        '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)' },
      },
      { dark: matchMedia('(prefers-color-scheme: dark)').matches },
    ),
    syntaxHighlighting(classHighlighter),
  ]
}

/** Loads the file's language into the compartment once its (lazily loaded) support arrives. */
export function loadLanguage(view: EditorView, compartment: Compartment, fileName: string): void {
  const description =
    LanguageDescription.matchFilename(languages, fileName) ??
    // .env files are shell-like assignments, which no language claims by name.
    (fileName.startsWith('.env') ? languages.find((l) => l.name === 'Shell') : undefined)
  if (!description) return
  void description.load().then((support) => {
    if (view.dom.isConnected) view.dispatch({ effects: compartment.reconfigure(support) })
  })
}

/**
 * The smallest single change that turns the document into the text on disk,
 * so a file edited elsewhere updates without moving the cursor or scroll
 * position. Document offsets count each line break as one character, so the
 * comparison is made with \n line breaks.
 */
export function changeFromDisk(state: EditorState, text: string): { from: number; to: number; insert: string } {
  const lineBreak = state.lineBreak
  const crlf = lineBreak !== '\n'
  const change = minimalChange(state.doc.toString(), crlf ? text.replaceAll(lineBreak, '\n') : text)
  return crlf ? { ...change, insert: change.insert.replaceAll('\n', lineBreak) } : change
}

export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0
  const shorter = Math.min(from.length, to.length)
  while (start < shorter && from[start] === to[start]) start++
  let end = 0
  while (end < shorter - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}
