import { useEffect, useSyncExternalStore } from 'react'
import type { Connection, ProjectConnections, StatementResult } from '../../shared/sql'
import { api } from './api'

/** The latest run of a SQL file. `results` grows to match `statements` unless it stops early. */
export type SqlRun = {
  runId: string
  statements: string[]
  running: boolean
  results: StatementResult[]
}

// Kept here rather than in the tab so that results survive switching projects,
// which unmounts every tab. They're not kept across restarts.
const connections = new Map<string, ProjectConnections>()
const runs = new Map<string, SqlRun>()
const listeners = new Set<() => void>()

function changed() {
  for (const listener of listeners) listener()
}

function useStore<T>(read: () => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, read)
}

function update(projectId: string, request: Promise<ProjectConnections>): Promise<void> {
  return request.then((next) => {
    connections.set(projectId, next)
    changed()
  })
}

/** `undefined` until loaded. */
export function useConnections(projectId: string): ProjectConnections | undefined {
  useEffect(() => {
    if (!connections.has(projectId)) void update(projectId, api.listConnections(projectId))
  }, [projectId])
  return useStore(() => connections.get(projectId))
}

export const saveConnection = (projectId: string, connection: Connection) =>
  update(projectId, api.saveConnection(projectId, connection))
export const deleteConnection = (projectId: string, connectionId: string) =>
  update(projectId, api.deleteConnection(projectId, connectionId))
export const setFileConnection = (projectId: string, path: string, connectionId: string) =>
  update(projectId, api.setFileConnection(projectId, path, connectionId))

const runKey = (projectId: string, path: string) => `${projectId}\0${path}`

export function useSqlRun(projectId: string, path: string): SqlRun | undefined {
  return useStore(() => runs.get(runKey(projectId, path)))
}

export async function runSql(projectId: string, path: string, connectionId: string, statements: string[]) {
  const key = runKey(projectId, path)
  const run: SqlRun = { runId: crypto.randomUUID(), statements, running: true, results: [] }
  runs.set(key, run)
  changed()
  let results: StatementResult[]
  try {
    results = await api.runSql(projectId, connectionId, run.runId, statements)
  } catch (error) {
    results = [{ kind: 'error', message: error instanceof Error ? error.message : String(error) }]
  }
  // A newer run replaces this one, even while this one is still finishing.
  if (runs.get(key)?.runId !== run.runId) return
  runs.set(key, { ...run, running: false, results })
  changed()
}

export function cancelSql(run: SqlRun) {
  void api.cancelSql(run.runId)
}
