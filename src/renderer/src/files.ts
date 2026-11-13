import { useEffect, useState } from 'react'
import { type DirectoryEntry, type FileContent, parentPath } from '../../shared/files'
import { api, subscribe } from './api'

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
