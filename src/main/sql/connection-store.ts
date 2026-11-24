import type { Connection, ProjectConnections } from '../../shared/sql'
import { deleteJson, projectJsonPath, readJson, writeJson } from '../json-file'

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

  /** Follows a file, or every file in a directory, to where it has moved. */
  moveFiles(projectId: string, from: string, to: string): Promise<ProjectConnections> {
    return this.change(projectId, (state) => {
      for (const [path, id] of Object.entries(state.files)) {
        if (path !== from && !path.startsWith(`${from}/`)) continue
        delete state.files[path]
        state.files[to + path.slice(from.length)] = id
      }
    })
  }

  async removeProject(projectId: string): Promise<void> {
    this.cache.delete(projectId)
    await deleteJson(this.path(projectId))
  }

  private async change(projectId: string, update: (state: ProjectConnections) => void): Promise<ProjectConnections> {
    const next = this.get(projectId).then(async (state) => {
      update(state)
      await writeJson(this.path(projectId), state)
      return state
    })
    // Later changes build on this one, so they're written in order. If it fails,
    // the next read goes back to what is on disk.
    this.cache.set(projectId, next)
    next.catch(() => this.cache.delete(projectId))
    return structuredClone(await next)
  }

  private path(projectId: string): string {
    return projectJsonPath(this.dataDir, 'connections', projectId)
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
