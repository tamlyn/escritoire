/** Paths are relative to the project root and use `/`; the root itself is `''`. */
export type DirectoryEntry = { name: string; path: string; isDirectory: boolean }

export type FileContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary' }
  | { kind: 'notUtf8' }
  | { kind: 'tooLarge'; size: number }
  | { kind: 'missing' }

export type WriteResult = 'saved' | 'missing'

/** Files created, changed or deleted by anything but the IDE itself, usually an agent. */
export type FilesChanged = { projectId: string; paths: string[] }

export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
