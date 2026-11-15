import { randomUUID } from 'node:crypto'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

/**
 * Postgres's password file, which libpq and psql read too. `pg` reads it itself
 * only until version 9, so Escritoire reads it as well as writing it.
 */
export type PgpassKey = { host: string; port: string; database: string; user: string }

const fields = ['host', 'port', 'database', 'user'] as const

export function pgpassPath(): string {
  return process.env.PGPASSFILE || join(homedir(), '.pgpass')
}

/** What `pg` connects to for the URL, after its defaults and `PG*` variables. */
export function pgpassKey(url: string): PgpassKey {
  const client = new pg.Client({ connectionString: url })
  return {
    host: client.host,
    port: String(client.port),
    database: client.database ?? client.user ?? '',
    user: client.user ?? '',
  }
}

/**
 * Takes a password out of a Postgres URL, as `user:password@` or `?password=`.
 * `save` puts it in the file, once whatever uses the URL has accepted it.
 */
export function separatePassword(url: string, path = pgpassPath()): { url: string; save: () => Promise<void> } {
  const none = { url, save: async () => {} }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return none
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return none
  const password = parsed.password ? decodeURIComponent(parsed.password) : parsed.searchParams.get('password')
  if (!password) return none
  parsed.password = ''
  parsed.searchParams.delete('password')
  const stripped = parsed.toString()
  return { url: stripped, save: () => savePassword(pgpassKey(stripped), password, path) }
}

/** As libpq does: `PGPASSWORD`, else the first matching line of the file. */
export async function lookupPassword(key: PgpassKey, path = pgpassPath()): Promise<string | undefined> {
  if (process.env.PGPASSWORD !== undefined) return process.env.PGPASSWORD
  const text = await readPgpass(path)
  if (text === undefined) return undefined
  // libpq ignores a file others can read; saying so beats a bare authentication failure.
  if ((await stat(path)).mode & 0o077) {
    throw new Error(`${path} is ignored because other users can read it. Run: chmod 600 ${path}`)
  }
  for (const entry of parse(text)) {
    if (fields.every((field, i) => entry[i] === '*' || entry[i] === key[field])) return entry[4]
  }
  return undefined
}

/**
 * Puts the password first in the file, replacing any line for exactly the same
 * connection, so that it wins over broader wildcard lines.
 */
export async function savePassword(key: PgpassKey, password: string, path = pgpassPath()): Promise<void> {
  const lines = ((await readPgpass(path)) ?? '').split('\n')
  const kept = lines.filter((line) => {
    const entry = parseLine(line)
    return !entry || !fields.every((field, i) => entry[i] === key[field])
  })
  const line = [...fields.map((field) => key[field]), password].map(escape).join(':')
  const text = [line, ...kept].join('\n').replace(/\n*$/, '\n')
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, path)
}

async function readPgpass(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parse(text: string): string[][] {
  return text
    .split('\n')
    .map(parseLine)
    .filter((entry) => entry !== undefined)
}

/** The five fields, unescaped, or `undefined` for a comment, blank or malformed line. */
function parseLine(line: string): string[] | undefined {
  if (line.startsWith('#') || !line.trim()) return undefined
  const entry: string[] = []
  let field = ''
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (char === '\\' && i + 1 < line.length) field += line[++i]
    else if (char === ':' && entry.length < 4) {
      entry.push(field)
      field = ''
    } else field += char
  }
  entry.push(field.replace(/\r$/, ''))
  return entry.length === 5 ? entry : undefined
}

function escape(value: string): string {
  return value.replace(/[\\:]/g, (char) => `\\${char}`)
}
