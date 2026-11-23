import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type FileMatches, type LineMatch, matchLine, queryRegExp, type SearchResults, type TextQuery } from '../shared/search'

// Larger files are almost always generated (bundles, lockfiles, data).
const maxFileSize = 1024 * 1024
const maxLines = 1000
const concurrency = 16
// Characters, roughly twice as many bytes.
const maxCachedLength = 64 * 1024 * 1024
const decoder = new TextDecoder()

type CachedFile = { mtimeMs: number; size: number; lines: string[] | null }

/**
 * Files' lines from earlier searches, for as long as they're unchanged on disk,
 * since each keystroke searches every file again. `null` for a file not searched.
 */
export class FileTextCache {
  private readonly files = new Map<string, CachedFile>()
  private length = 0

  async lines(file: string): Promise<string[] | null> {
    let info
    try {
      info = await stat(file)
    } catch {
      // Gone since it was listed.
      return null
    }
    const cached = this.files.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.lines
    const lines = info.size > maxFileSize ? null : await readLines(file)
    this.remember(file, { mtimeMs: info.mtimeMs, size: info.size, lines })
    return lines
  }

  private remember(file: string, entry: CachedFile): void {
    const length = (lines: string[] | null) => lines?.reduce((sum, line) => sum + line.length, 0) ?? 0
    const previous = this.files.get(file)
    if (previous) this.length -= length(previous.lines)
    this.length += length(entry.lines)
    this.files.set(file, entry)
    // Starting again is simpler than tracking use, and a search refills it.
    if (this.length > maxCachedLength) {
      this.files.clear()
      this.length = 0
    }
  }
}

async function readLines(file: string): Promise<string[] | null> {
  let buffer: Buffer
  try {
    buffer = await readFile(file)
  } catch {
    // Gone since it was listed, or a link to a directory.
    return null
  }
  // Git's heuristic: a NUL byte near the start means binary.
  if (buffer.subarray(0, 8000).includes(0)) return null
  return decoder.decode(buffer).split(/\r?\n/)
}

/**
 * Searches the given files, in order, line by line. Stops at `maxLines`
 * matching lines, or with `null` once `signal` aborts.
 */
export async function searchFiles(
  root: string,
  paths: readonly string[],
  query: TextQuery,
  signal: AbortSignal,
  cache = new FileTextCache(),
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
      const lines = searchLines((await cache.lines(join(root, paths[index]!))) ?? [], new RegExp(regexp))
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

function searchLines(lines: string[], regexp: RegExp): LineMatch[] {
  const matches: LineMatch[] = []
  lines.forEach((text, index) => {
    const match = matchLine(text, index + 1, regexp)
    if (match) matches.push(match)
  })
  return matches
}
