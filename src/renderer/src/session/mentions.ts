/** A word being completed at the caret: where it starts (at its sigil) and what follows the sigil so far. */
export type Mention = { start: number; query: string }

/** The mention the caret is in: an `@` at the start of a word, with no space after it yet. */
export function activeMention(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)@(\S*)$/.exec(before)
  if (!match) return null
  return { start: caret - match[1]!.length - 1, query: match[1]! }
}

/** The slash command the caret is in: a `/` that starts the message, with no space after it yet. */
export function activeCommand(text: string, caret: number): Mention | null {
  const match = /^\/(\S*)$/.exec(text.slice(0, caret))
  return match ? { start: 0, query: match[1]! } : null
}

/** Replaces the mention, sigil and all, with the word and a space, and returns the caret after it. */
export function insertMention(text: string, caret: number, mention: Mention, word: string) {
  const inserted = `${word} `
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(caret).replace(/^ /, ''),
    caret: mention.start + inserted.length,
  }
}
