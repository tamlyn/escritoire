import { useEffect, useState, useSyncExternalStore } from 'react'
import { type DirectoryEntry, type FileContent, parentPath } from '../../shared/files'
import { api, subscribe } from './api'

const recentForMs = 10_000

type Recent = { projectId: string; paths: ReadonlySet<string> }

let recent: Recent = { projectId: '', paths: new Set() }
const recentListeners = new Set<() => void>()

function setRecent(next: Recent) {
  recent = next
  for (const listener of recentListeners) listener()
}

// Changes reported by main are made by something other than the IDE, usually
// an agent, so they're marked for a while to make them visible.
subscribe('filesChanged', ({ projectId, paths }) => {
  const kept = recent.projectId === projectId ? recent.paths : []
  setRecent({ projectId, paths: new Set([...kept, ...paths]) })
  setTimeout(() => {
    if (recent.projectId !== projectId) return
    const remaining = new Set(recent.paths)
    for (const path of paths) remaining.delete(path)
    setRecent({ projectId, paths: remaining })
  }, recentForMs)
})

function useRecent(): Recent {
  return useSyncExternalStore(
    (listener) => {
      recentListeners.add(listener)
      return () => recentListeners.delete(listener)
    },
    () => recent,
  )
}

/** Whether the file, or for a directory anything inside it, changed recently. */
export function useRecentlyChanged(projectId: string, path: string): boolean {
  const { projectId: changedIn, paths } = useRecent()
  if (changedIn !== projectId) return false
  if (paths.has(path)) return true
  const prefix = `${path}/`
  for (const changed of paths) if (changed.startsWith(prefix)) return true
  return false
}

/** Lists a directory, and lists it again whenever something in it changes. */
export function useDirectory(projectId: string, path: string): DirectoryEntry[] | null {
  return useLiveLoad(
    () => api.listDirectory(projectId, path),
    (changed) => changed.some((p) => parentPath(p) === path),
    [projectId, path],
  )
}

/** Reads a file, and reads it again whenever it changes. */
export function useFileContent(projectId: string, path: string): FileContent | null {
  return useLiveLoad(
    () => api.readFile(projectId, path),
    (changed) => changed.includes(path),
    [projectId, path],
  )
}

function useLiveLoad<T>(
  load: () => Promise<T>,
  affectedBy: (changed: string[]) => boolean,
  deps: [projectId: string, path: string],
): T | null {
  const [value, setValue] = useState<T | null>(null)
  const [projectId] = deps

  useEffect(() => {
    let latest = 0
    const reload = () => {
      const request = ++latest
      void load().then(
        (loaded) => request === latest && setValue(loaded),
        (error: unknown) => console.error(error),
      )
    }
    reload()
    return subscribe('filesChanged', (event) => {
      if (event.projectId === projectId && affectedBy(event.paths)) reload()
    })
  }, deps)

  return value
}
