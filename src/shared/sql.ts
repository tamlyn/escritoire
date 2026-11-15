/** A saved database connection. Never holds a password: Postgres reads `~/.pgpass` and `PG*` variables. */
export type Connection = { id: string; name: string } & ConnectionTarget

export type ConnectionTarget =
  /** `path` is relative to the project, or absolute. */
  | { type: 'sqlite'; path: string }
  | { type: 'postgres'; url: string }

/** A project's connections, and which one each SQL file uses (by path relative to the project). */
export type ProjectConnections = {
  connections: Connection[]
  files: Record<string, string>
}

export function isSqlFile(path: string): boolean {
  return path.toLowerCase().endsWith('.sql')
}

/** The connection a file uses: the one chosen for it, otherwise the project's only one. */
export function connectionForFile(state: ProjectConnections, path: string): Connection | undefined {
  const chosen = state.files[path]
  return (
    state.connections.find((c) => c.id === chosen) ??
    (state.connections.length === 1 ? state.connections[0] : undefined)
  )
}

/** A name for a new connection: `database@host` for Postgres, the file's name for SQLite. */
export function defaultConnectionName(target: ConnectionTarget): string {
  if (target.type === 'sqlite') return target.path.trim().split(/[\\/]/).pop() ?? ''
  let url: URL
  try {
    url = new URL(target.url.trim())
  } catch {
    return ''
  }
  const host = url.hostname || 'localhost'
  // As in Postgres, the database defaults to the user's name.
  const database = decodeURIComponent(url.pathname.slice(1)) || decodeURIComponent(url.username)
  return database ? `${database}@${host}` : host
}

/** Rows beyond this aren't fetched, so a careless `select *` stays cheap. */
export const maxResultRows = 500

export type StatementResult =
  | {
      kind: 'rows'
      columns: string[]
      /** Values are already display strings; `null` is SQL NULL. */
      rows: (string | null)[][]
      /** More rows existed than were fetched. */
      truncated: boolean
      ms: number
    }
  | { kind: 'done'; affected: number | null; ms: number }
  | { kind: 'error'; message: string }

/** A statement's position in its file: `to` excludes the terminating semicolon. */
export type StatementRange = { from: number; to: number }

/**
 * Splits SQL into statements at semicolons that aren't inside quotes, comments
 * or Postgres dollar quoting. Leading comments and blank statements are left
 * out. SQLite trigger bodies (`BEGIN … END`) aren't understood and split early.
 */
export function splitStatements(text: string): StatementRange[] {
  const statements: StatementRange[] = []
  let from = -1
  let to = -1
  const code = (start: number, end: number) => {
    if (from < 0) from = start
    to = end
  }
  const finish = () => {
    if (from >= 0) statements.push({ from, to })
    from = -1
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]!
    const next = text[i + 1]
    if (char === ';') {
      finish()
      i++
    } else if (char === '-' && next === '-') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
    } else if (char === '/' && next === '*') {
      i = blockCommentEnd(text, i)
    } else if (char === "'" || char === '"' || char === '`') {
      const end = quoteEnd(text, i, char)
      code(i, end)
      i = end
    } else if (char === '$' && !isIdentifierChar(text[i - 1])) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i))?.[0]
      const close = tag ? text.indexOf(tag, i + tag.length) : -1
      const end = !tag ? i + 1 : close < 0 ? text.length : close + tag.length
      code(i, end)
      i = end
    } else if (/\s/.test(char)) {
      i++
    } else {
      code(i, i + 1)
      i++
    }
  }
  finish()
  return statements
}

/**
 * The statements to run for a selection: every one it touches or, for a bare
 * cursor, the one it's in. Between statements, a cursor still on the line where
 * one ended runs that one; otherwise it runs the next.
 */
export function statementsToRun(text: string, from: number, to: number): StatementRange[] {
  const statements = splitStatements(text)
  if (from !== to) return statements.filter((s) => s.from < to && from <= s.to)
  const index = statements.findLastIndex((s) => s.from <= from)
  const before = statements[index]
  const chosen =
    before && (from <= before.to || !text.slice(before.to, from).includes('\n'))
      ? before
      : (statements[index + 1] ?? before)
  return chosen ? [chosen] : []
}

function quoteEnd(text: string, start: number, quote: string): number {
  let i = start + 1
  while (i < text.length) {
    if (text[i] === quote) {
      // A doubled quote is an escaped one.
      if (text[i + 1] === quote) i += 2
      else return i + 1
    } else {
      i++
    }
  }
  return text.length
}

// Postgres block comments nest.
function blockCommentEnd(text: string, start: number): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      depth++
      i += 2
    } else if (text.startsWith('*/', i)) {
      depth--
      i += 2
      if (depth === 0) return i
    } else {
      i++
    }
  }
  return text.length
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char)
}
