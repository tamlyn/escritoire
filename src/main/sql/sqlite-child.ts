// One SQLite connection in its own process. node:sqlite blocks and can't be
// interrupted, so main would freeze during a query and a worker thread couldn't
// be stopped mid-query; a process can be killed.
// Only type imports beyond node built-ins: tests run this file directly under Node.
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { StatementResult } from '../../shared/sql'

const [path, maxRowsArg] = process.argv.slice(2) as [string, string]
const maxRows = Number(maxRowsArg)
// Waits rather than failing at once while an app using the database holds a lock.
const db = new DatabaseSync(path, { timeout: 5000 })
const totalChanges = db.prepare('select total_changes()')
totalChanges.setReturnArrays(true)

process.on('message', (sql: string) => {
  process.send!(run(sql))
})
process.on('disconnect', () => process.exit())

function run(sql: string): StatementResult {
  const start = performance.now()
  const ms = () => Math.round(performance.now() - start)
  try {
    const statement = db.prepare(sql)
    const columns = statement.columns().map((c) => c.name)
    if (columns.length === 0) {
      const before = changes()
      statement.run()
      return { kind: 'done', affected: changes() - before, ms: ms() }
    }
    const { rows, truncated } = readRows(statement)
    return { kind: 'rows', columns, rows, truncated, ms: ms() }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

function readRows(statement: StatementSync) {
  statement.setReturnArrays(true)
  statement.setReadBigInts(true)
  const rows: (string | null)[][] = []
  for (const row of statement.iterate() as Iterable<unknown[]>) {
    if (rows.length === maxRows) return { rows, truncated: true }
    rows.push(row.map(display))
  }
  return { rows, truncated: false }
}

// Counts only rows changed by inserts, updates and deletes, unlike the result of `run()` after DDL.
function changes(): number {
  return Number((totalChanges.all() as unknown as unknown[][])[0]![0])
}

function display(value: unknown): string | null {
  if (value === null) return null
  if (value instanceof Uint8Array) {
    // Enough to recognise a blob without sending a large one to the renderer.
    const hex = Buffer.from(value.subarray(0, 32)).toString('hex')
    return value.length > 32 ? `x'${hex}…' (${value.length} bytes)` : `x'${hex}'`
  }
  return String(value)
}
