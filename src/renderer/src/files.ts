import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { type DirectoryEntry, type FileContent, parentPath } from '../../shared/files'
import { api, subscribe } from './api'

/** A path inside the project relative to it, so it opens the same tab as from the tree; any other path unchanged. */
export function projectRelativePath(projectPath: string, path: string): string {
  const root = projectPath.replace(/\/$/, '')
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** A file opened from outside the project keeps the full path it was opened with, which may start with `~`. */
export function isOutsideProject(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~')
}

export function absolutePath(projectPath: string, path: string): string {
  if (isOutsideProject(path)) return path
  return `${projectPath.replace(/\/$/, '')}/${path}`
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

// Listing walks the whole project, and an agent can change many files a second.
const fileListRefreshMs = 2000

type FileList = { files: Set<string> | null; listeners: Set<() => void>; stop: () => void }

/** One list per project, however many session tabs are showing its links. */
const fileLists = new Map<string, FileList>()

function startFileList(projectId: string): FileList {
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    timer = undefined
    const request = ++latest
    void api.listProjectFiles(projectId).then((files) => {
      if (request !== latest) return
      list.files = new Set(files)
      for (const listener of list.listeners) listener()
    }, console.error)
  }
  const unsubscribe = subscribe('filesChanged', (event) => {
    if (event.projectId === projectId) timer ??= setTimeout(refresh, fileListRefreshMs)
  })
  const list: FileList = {
    files: null,
    listeners: new Set(),
    stop: () => {
      unsubscribe()
      clearTimeout(timer)
    },
  }
  refresh()
  return list
}

/** The project's files, kept up to date so files an agent creates are included. `null` until listed. */
export function useProjectFileList(projectId: string): Set<string> | null {
  const subscribeToList = useCallback((listener: () => void) => {
    const list = fileLists.get(projectId) ?? startFileList(projectId)
    fileLists.set(projectId, list)
    list.listeners.add(listener)
    return () => {
      list.listeners.delete(listener)
      if (list.listeners.size > 0) return
      list.stop()
      fileLists.delete(projectId)
    }
  }, [projectId])
  return useSyncExternalStore(subscribeToList, () => fileLists.get(projectId)?.files ?? null)
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
