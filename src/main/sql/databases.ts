import { isAbsolute, resolve } from 'node:path'
import type { Connection, StatementResult } from '../../shared/sql'
import { expandHome } from '../paths'
import { Work } from '../work'
import { type Database, errorResult } from './database'
import { openPostgres } from './postgres'
import { openSqlite } from './sqlite'

type Open = {
  projectId: string
  connectionId: string
  database: Promise<Database>
  /** Runs on one connection take turns. */
  queue: Promise<unknown>
}

type Run = { open: Open; cancelled: boolean; running: boolean }

/**
 * The open connections of every project, one per saved connection, opened on
 * first use. Keeping each open lets a transaction or `SET` carry over between
 * runs, as in psql.
 */
export class Databases {
  private readonly open = new Map<string, Open>()
  private readonly runs = new Map<string, Run>()
  private readonly work = new Work()

  constructor(
    private readonly options: {
      projectPath: (projectId: string) => string
      connection: (projectId: string, connectionId: string) => Promise<Connection>
    },
  ) {}

  /** Runs the statements in order, stopping after the first error or a cancel. */
  run(projectId: string, connectionId: string, runId: string, statements: string[]): Promise<StatementResult[]> {
    return this.work.run(async () => {
      const open = this.connect(projectId, connectionId)
      const run: Run = { open, cancelled: false, running: false }
      this.runs.set(runId, run)
      const results = open.queue.then(async () => {
        const database = await open.database
        const results: StatementResult[] = []
        for (const sql of statements) {
          if (run.cancelled) {
            results.push({ kind: 'error', message: 'Cancelled' })
            break
          }
          run.running = true
          const result = await database.run(sql)
          run.running = false
          results.push(result)
          if (result.kind === 'error') break
        }
        return results
      })
      open.queue = results.catch(() => {})
      try {
        return await results
      } catch (error) {
        // Couldn't connect, so forget the attempt and try afresh next time.
        if (this.open.get(key(projectId, connectionId)) === open) this.open.delete(key(projectId, connectionId))
        return [errorResult(error)]
      } finally {
        this.runs.delete(runId)
      }
    })
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    run.cancelled = true
    if (run.running) await (await run.open.database).cancel()
  }

  /** After a connection is edited or deleted, so the next run uses its new settings. */
  async closeConnection(projectId: string, connectionId: string): Promise<void> {
    const open = this.open.get(key(projectId, connectionId))
    if (open) await this.close(open)
  }

  async closeProject(projectId: string): Promise<void> {
    await Promise.all([...this.open.values()].filter((o) => o.projectId === projectId).map((o) => this.close(o)))
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open.values()].map((o) => this.close(o)))
    await this.work.close()
  }

  private connect(projectId: string, connectionId: string): Open {
    const existing = this.open.get(key(projectId, connectionId))
    if (existing) return existing
    const open: Open = {
      projectId,
      connectionId,
      queue: Promise.resolve(),
      database: this.options.connection(projectId, connectionId).then((connection) => {
        const onLost = () => {
          if (this.open.get(key(projectId, connectionId)) === open) this.open.delete(key(projectId, connectionId))
        }
        return connection.type === 'sqlite'
          ? openSqlite(this.sqlitePath(projectId, connection.path), onLost)
          : openPostgres(connection.url, onLost)
      }),
    }
    open.database.catch(() => {})
    this.open.set(key(projectId, connectionId), open)
    return open
  }

  private async close(open: Open): Promise<void> {
    this.open.delete(key(open.projectId, open.connectionId))
    for (const run of this.runs.values()) if (run.open === open) run.cancelled = true
    const database = await open.database.catch(() => null)
    // Closing stops whatever is running; queued runs then find the connection closed.
    await database?.close().catch(console.error)
  }

  private sqlitePath(projectId: string, path: string): string {
    const expanded = expandHome(path)
    return isAbsolute(expanded) ? expanded : resolve(this.options.projectPath(projectId), expanded)
  }
}

function key(projectId: string, connectionId: string): string {
  return `${projectId}\0${connectionId}`
}
