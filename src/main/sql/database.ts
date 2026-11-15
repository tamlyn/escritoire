import type { StatementResult } from '../../shared/sql'

/** One open connection to a database, running one statement at a time. */
export type Database = {
  /** Never rejects: a failing statement is an `error` result. */
  run(sql: string): Promise<StatementResult>
  /** Stops the statement running now, if any, which then resolves as an error. */
  cancel(): Promise<void>
  close(): Promise<void>
}

/** Called if the connection ends on its own, so the next run opens a fresh one. */
export type OnLost = () => void

export function errorResult(error: unknown): StatementResult {
  return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
}
