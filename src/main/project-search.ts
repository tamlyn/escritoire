import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type FileMatches, type LineMatch, matchLine, queryRegExp, type SearchResults, type TextQuery } from '../shared/search'

// Larger files are almost always generated (bundles, lockfiles, data).
const maxFileSize = 1024 * 1024
const maxLines = 1000
const concurrency = 16
const decoder = new TextDecoder()

/**
 * Searches the given files, in order, line by line. Stops at `maxLines`
 * matching lines, or with `null` once `signal` aborts.
 */
export async function searchFiles(
  root: string,
  paths: readonly string[],
  query: TextQuery,
  signal: AbortSignal,
): Promise<SearchResults | null> {
  const regexp = queryRegExp(query)
  if (!regexp) return { files: [], truncated: false }

  // By index, so results come out in the list's order however reads finish.
  const found: (LineMatch[] | undefined)[] = []
  let total = 0
  let next = 0
  const worker = async () => {
    while (next < paths.length && total < maxLines && !signal.aborted) {
      const index = next++
      // Each worker has its own copy, since the expression keeps state between matches.
      const lines = await searchFile(join(root, paths[index]!), new RegExp(regexp))
      found[index] = lines
      total += lines.length
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  if (signal.aborted) return null

  const files: FileMatches[] = []
  let count = 0
  for (const [index, lines] of found.entries()) {
    if (!lines?.length) continue
    const kept = lines.slice(0, maxLines - count)
    files.push({ path: paths[index]!, lines: kept })
    count += kept.length
    if (count === maxLines) break
  }
  return { files, truncated: total > maxLines || (total === maxLines && next < paths.length) }
}

async function searchFile(file: string, regexp: RegExp): Promise<LineMatch[]> {
  let buffer: Buffer
  try {
    if ((await stat(file)).size > maxFileSize) return []
    buffer = await readFile(file)
  } catch {
    // Gone since it was listed, or a link to a directory.
    return []
  }
  // Git's heuristic: a NUL byte near the start means binary.
  if (buffer.subarray(0, 8000).includes(0)) return []
  const lines: LineMatch[] = []
  decoder
    .decode(buffer)
    .split(/\r?\n/)
    .forEach((text, index) => {
      const match = matchLine(text, index + 1, regexp)
      if (match) lines.push(match)
    })
  return lines
}
