import pg from 'pg'
import Cursor from 'pg-cursor'
import { maxResultRows, type StatementResult } from '../../shared/sql'
import { type Database, errorResult, type OnLost } from './database'
import { lookupPassword, pgpassKey } from './pgpass'

// Postgres's own text for every type, rather than JavaScript values that would
// have to be formatted back (dates, JSON, arrays, bytea).
const asText: pg.CustomTypesConfig = { getTypeParser: () => (value: string) => value }

export async function openPostgres(url: string, onLost: OnLost): Promise<Database> {
  const client = newClient(url)
  // Without an error listener, a dropped connection would throw in main.
  client.on('error', () => {})
  client.once('end', onLost)
  await client.connect()
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
  let running = false
  const cancel = async () => {
    if (!running) return
    const canceller = newClient(url)
    await canceller.connect()
    try {
      await canceller.query('select pg_cancel_backend($1)', [pid])
    } finally {
      await canceller.end()
    }
  }

  return {
    run: async (sql) => {
      running = true
      try {
        return await runStatement(client, sql)
      } finally {
        running = false
      }
    },
    cancel,
    close: async () => {
      // The server only reads the request to disconnect between queries.
      await cancel().catch(() => {})
      await client.end()
    },
  }
}

/** Passwords come from `PGPASSWORD` or `~/.pgpass`, looked up only if the server asks for one. */
function newClient(url: string): pg.Client {
  return new pg.Client({
    connectionString: url,
    application_name: 'Escritoire',
    connectionTimeoutMillis: 10_000,
    // `pg` treats `undefined` as no password, though its types don't allow it.
    password: async () => (await lookupPassword(pgpassKey(url)))!,
  })
}

async function runStatement(client: pg.Client, sql: string): Promise<StatementResult> {
  const start = performance.now()
  // A cursor so that only the rows shown are fetched.
  const cursor = client.query(new Cursor<string[]>(sql, undefined, { rowMode: 'array', types: asText }))
  try {
    const { rows, result } = await new Promise<{ rows: string[][]; result: pg.QueryResult }>((resolve, reject) =>
      cursor.read(maxResultRows + 1, (error, rows, result) => (error ? reject(error) : resolve({ rows, result }))),
    )
    const ms = Math.round(performance.now() - start)
    if (result.fields.length === 0) return { kind: 'done', affected: result.rowCount, ms }
    await cursor.close()
    return {
      kind: 'rows',
      columns: result.fields.map((f) => f.name),
      rows: rows.slice(0, maxResultRows),
      truncated: rows.length > maxResultRows,
      ms,
    }
  } catch (error) {
    return errorResult(describe(error))
  }
}

function describe(error: unknown): unknown {
  if (!(error instanceof pg.DatabaseError)) return error
  return [error.message, error.detail && `Detail: ${error.detail}`, error.hint && `Hint: ${error.hint}`]
    .filter(Boolean)
    .join('\n')
}
