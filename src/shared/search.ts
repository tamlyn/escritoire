/** What to look for across the project's files. */
export type TextQuery = { text: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }

/** A line with at least one match. Columns are offsets into the line. */
export type LineMatch = {
  /** From 1. */
  line: number
  /** The first match, for selecting it in the editor. */
  from: number
  to: number
  /** The line as shown: without its indent, and clipped around the first match if long. */
  preview: string
  /** Every match in `preview`, as offsets into it. */
  ranges: [number, number][]
}

export type FileMatches = { path: string; lines: LineMatch[] }

export type SearchResults = {
  files: FileMatches[]
  /** Whether the search stopped at its limit, so there are more matches than these. */
  truncated: boolean
}

/** The query as a global regular expression; `null` if it's empty or not a valid expression. */
export function queryRegExp(query: TextQuery): RegExp | null {
  if (!query.text) return null
  let source = query.regexp ? query.text : escapeRegExp(query.text)
  // Neither end may fall between two word characters, so a match that starts or ends with punctuation needs no space there.
  const boundary = '(?:(?<!\\w)|(?!\\w))'
  if (query.wholeWord) source = `${boundary}(?:${source})${boundary}`
  try {
    return new RegExp(source, query.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/** The non-empty matches of a global `regexp` in the text. */
export function findRanges(text: string, regexp: RegExp): [number, number][] {
  const found: [number, number][] = []
  regexp.lastIndex = 0
  for (let match = regexp.exec(text); match; match = regexp.exec(text)) {
    if (match[0].length === 0) regexp.lastIndex++
    else found.push([match.index, match.index + match[0].length])
  }
  return found
}

const previewLength = 200
// How much of a long line to show before its first match.
const previewLead = 40

/** The non-empty matches of `regexp` in one line, as shown in results; `null` if there are none. */
export function matchLine(text: string, line: number, regexp: RegExp): LineMatch | null {
  const found = findRanges(text, regexp)
  const [first] = found
  if (!first) return null

  const indent = text.length - text.trimStart().length
  const start = Math.min(first[0], text.length - indent > previewLength ? Math.max(indent, first[0] - previewLead) : indent)
  const end = Math.min(text.length, start + previewLength)
  const prefix = start > indent ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const shift = prefix.length - start
  return {
    line,
    from: first[0],
    to: first[1],
    preview: prefix + text.slice(start, end) + suffix,
    ranges: found
      .filter(([from, to]) => to > start && from < end)
      .map(([from, to]) => [Math.max(from, start) + shift, Math.min(to, end) + shift]),
  }
}
