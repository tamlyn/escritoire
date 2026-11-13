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

/**
 * Files matching the query, best first. The characters must appear in order;
 * matches in the file name, contiguous matches and shorter paths rank higher.
 */
export function matchFiles(files: string[], query: string, limit: number): string[] {
  const needle = query.toLowerCase()
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const score = scorePath(path.toLowerCase(), needle)
    if (score !== null) scored.push({ path, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((s) => s.path)
}

function scorePath(path: string, needle: string): number | null {
  if (!needle) return 0
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name.startsWith(needle)) return 4
  if (name.includes(needle)) return 3
  if (path.includes(needle)) return 2
  let position = 0
  for (const char of needle) {
    position = path.indexOf(char, position)
    if (position === -1) return null
    position++
  }
  return 1
}
