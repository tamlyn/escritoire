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

/** Relative to the project, without empty or `.` segments; `null` if it doesn't name a file. */
export function normalizePath(input: string): string | null {
  if (input.endsWith('/')) return null
  return (
    input
      .trim()
      .split('/')
      .filter((segment) => segment && segment !== '.')
      .join('/') || null
  )
}

/** Whether `path` is `ancestor` or inside it. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}
