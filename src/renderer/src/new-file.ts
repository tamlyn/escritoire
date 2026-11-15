export type NewFileTarget = { kind: 'scratch'; extension: string } | { kind: 'path'; path: string }

/**
 * What the new file input asks for. A bare extension (`.sql`) makes a scratch
 * file; anything else is a path in the project, so `./.env` makes a dotfile.
 */
export function newFileTarget(input: string): NewFileTarget | null {
  const trimmed = input.trim()
  const scratch = /^\.([\w+-]+(?:\.[\w+-]+)*)$/.exec(trimmed)
  if (scratch) return { kind: 'scratch', extension: scratch[1]! }
  const path = normalizePath(trimmed)
  return path ? { kind: 'path', path } : null
}

/**
 * Relative to the project, in the form the file tree and watcher use, so a tab
 * opened from either finds the same file. `null` if it doesn't name a file in
 * the project.
 */
export function normalizePath(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.endsWith('/')) return null
  const segments: string[] = []
  for (const segment of trimmed.split('/')) {
    if (segment === '..') {
      if (segments.pop() === undefined) return null
    } else if (segment && segment !== '.') {
      segments.push(segment)
    }
  }
  return segments.join('/') || null
}

/** Whether `path` is `ancestor` or inside it. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}
