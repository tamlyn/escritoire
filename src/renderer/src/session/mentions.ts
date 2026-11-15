/** An `@` being typed at the caret: where it starts and what follows it so far. */
export type Mention = { start: number; query: string }

/** The mention the caret is in: an `@` at the start of a word, with no space after it yet. */
export function activeMention(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)@(\S*)$/.exec(before)
  if (!match) return null
  return { start: caret - match[1]!.length - 1, query: match[1]! }
}

/** Replaces the mention with the path, followed by a space, and returns the caret after it. */
export function insertMention(text: string, caret: number, mention: Mention, path: string) {
  const inserted = `@${path} `
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(caret).replace(/^ /, ''),
    caret: mention.start + inserted.length,
  }
}
