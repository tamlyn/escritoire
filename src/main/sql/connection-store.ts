import { join } from 'node:path'
import type { Connection, ProjectConnections } from '../../shared/sql'
import { deleteJson, readJson, writeJson } from '../json-file'

/** Each project's saved connections, in the app data directory rather than the project. */
export class ConnectionStore {
  private readonly cache = new Map<string, Promise<ProjectConnections>>()

  constructor(private readonly dataDir: string) {}

  get(projectId: string): Promise<ProjectConnections> {
    let loaded = this.cache.get(projectId)
    if (!loaded) {
      loaded = readJson(this.path(projectId)).then(
        (saved) => (saved as ProjectConnections | undefined) ?? { connections: [], files: {} },
      )
      this.cache.set(projectId, loaded)
      loaded.catch(() => this.cache.delete(projectId))
    }
    return loaded.then((state) => structuredClone(state))
  }

  async getConnection(projectId: string, connectionId: string): Promise<Connection> {
    const connection = (await this.get(projectId)).connections.find((c) => c.id === connectionId)
    if (!connection) throw new Error('That connection no longer exists')
    return connection
  }

  /** Adds the connection, or replaces the one with its id. */
  async save(projectId: string, connection: Connection): Promise<ProjectConnections> {
    validateConnection(connection)
    return this.change(projectId, (state) => {
      const index = state.connections.findIndex((c) => c.id === connection.id)
      if (index < 0) state.connections.push(connection)
      else state.connections[index] = connection
    })
  }

  delete(projectId: string, connectionId: string): Promise<ProjectConnections> {
    return this.change(projectId, (state) => {
      state.connections = state.connections.filter((c) => c.id !== connectionId)
      for (const [path, id] of Object.entries(state.files)) if (id === connectionId) delete state.files[path]
    })
  }

  setFileConnection(projectId: string, path: string, connectionId: string): Promise<ProjectConnections> {
    return this.change(projectId, (state) => {
      state.files[path] = connectionId
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    this.cache.delete(projectId)
    await deleteJson(this.path(projectId))
  }

  private async change(projectId: string, update: (state: ProjectConnections) => void): Promise<ProjectConnections> {
    const next = this.get(projectId).then((state) => {
      update(state)
      return state
    })
    // Later changes build on this one even before it has been written.
    this.cache.set(projectId, next)
    next.catch(() => this.cache.delete(projectId))
    const state = await next
    await writeJson(this.path(projectId), state)
    return structuredClone(state)
  }

  private path(projectId: string): string {
    return join(this.dataDir, 'connections', `${projectId}.json`)
  }
}

function validateConnection(connection: Connection): void {
  if (!connection.name.trim()) throw new Error('A connection needs a name')
  if (connection.type === 'sqlite') {
    if (!connection.path.trim()) throw new Error('A SQLite connection needs the path to its database file')
    return
  }
  let url: URL
  try {
    url = new URL(connection.url)
  } catch {
    throw new Error('Expected a URL like postgres://user@host:5432/database')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Expected a URL starting postgres://')
  }
  if (url.password || url.searchParams.has('password')) {
    // Moved to ~/.pgpass before saving, so this guards against storing one by mistake.
    throw new Error("Escritoire doesn't store passwords. Put it in ~/.pgpass instead.")
  }
}
