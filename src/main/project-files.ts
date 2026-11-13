import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import watcher, { type AsyncSubscription } from '@parcel/watcher'
import type { DirectoryEntry, FileContent, FilesChanged, WriteResult } from '../shared/files'

const hiddenNames = new Set(['.git', '.DS_Store'])
// node_modules can hold tens of thousands of directories, which on Linux means
// as many inotify watches. The tree still lists them; they just don't refresh
// live. Globs, because the watcher resolves plain names against the root only.
const unwatched = ['**/.git/**', '**/node_modules/**']
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const maxFileSize = 5 * 1024 * 1024

type Options = {
  projectPath: (projectId: string) => string
  send: (payload: FilesChanged) => void
  /** Any change in the watched project, including the IDE's own writes. */
  onAnyChange?: (projectId: string) => void
}

/** The files of each project, and a watcher on the active project only. */
export class ProjectFiles {
  private watched?: { projectId: string; subscription: Promise<AsyncSubscription | undefined> }
  // What the IDE last wrote to each file, to tell its own writes from others'
  // when the watcher reports them. A time window would hide an agent's edit
  // made just after an autosave.
  private readonly ownWrites = new Map<string, string>()

  constructor(private readonly options: Options) {}

  async listDirectory(projectId: string, path: string): Promise<DirectoryEntry[]> {
    const directory = this.resolve(projectId, path)
    const entries = await readdir(directory, { withFileTypes: true })
    const listed = await Promise.all(
      entries
        .filter((entry) => !hiddenNames.has(entry.name))
        .map(async (entry) => ({
          name: entry.name,
          path: path ? `${path}/${entry.name}` : entry.name,
          isDirectory:
            entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(directory, entry.name)))),
        })),
    )
    return listed.sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    )
  }

  async readFile(projectId: string, path: string): Promise<FileContent> {
    const file = this.resolve(projectId, path)
    try {
      const info = await stat(file)
      if (!info.isFile()) return { kind: 'missing' }
      if (info.size > maxFileSize) return { kind: 'tooLarge', size: info.size }
      const buffer = await readFile(file)
      // Git's heuristic: a NUL byte near the start means binary.
      if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary' }
      try {
        // Other encodings would be corrupted by saving them back as UTF-8.
        return { kind: 'text', text: utf8.decode(buffer) }
      } catch {
        return { kind: 'notUtf8' }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      throw error
    }
  }

  /**
   * Overwrites an existing file. Never creates one, so a pending save can't
   * bring back a file an agent has just deleted.
   */
  async writeFile(projectId: string, path: string, text: string): Promise<WriteResult> {
    const file = this.resolve(projectId, path)
    let handle
    try {
      // In place rather than via a rename, so hard links, permissions and other
      // programs' watches on the file survive.
      handle = await open(file, 'r+')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
      throw error
    }
    try {
      // Keyed by the real path, which is what the watcher reports.
      this.ownWrites.set(await realpath(file), text)
      const data = Buffer.from(text)
      await handle.write(data, 0, data.length, 0)
      await handle.truncate(data.length)
    } finally {
      await handle.close()
    }
    return 'saved'
  }

  /** Watches the given project, replacing any previous watch. */
  watch(projectId: string | null): void {
    if (this.watched?.projectId === projectId) return
    this.unwatch()
    if (!projectId) return
    const root = this.options.projectPath(projectId)
    const subscription = watcher
      .subscribe(
        root,
        async (error, events) => {
          if (error) {
            console.error(`Watching ${root} failed:`, error)
            return
          }
          this.options.onAnyChange?.(projectId)
          const others = await Promise.all(
            events.map(async ({ path }) => (path !== root && !(await this.isOwnWrite(path)) ? path : null)),
          )
          const paths = others.filter((path) => path !== null).map((path) => toProjectPath(root, path))
          if (paths.length > 0) this.options.send({ projectId, paths })
        },
        { ignore: unwatched },
      )
      .catch((error: unknown) => {
        console.error(`Could not watch ${root}:`, error)
        return undefined
      })
    this.watched = { projectId, subscription }
  }

  unwatch(): Promise<void> {
    const watched = this.watched
    this.watched = undefined
    this.ownWrites.clear()
    return watched ? watched.subscription.then((s) => s?.unsubscribe()) : Promise.resolve()
  }

  private async isOwnWrite(file: string): Promise<boolean> {
    const written = this.ownWrites.get(file)
    if (written === undefined) return false
    // Kept after a mismatch: the watcher can report a write part-way through,
    // and the finished write must still be recognised.
    const current = await readFile(file, 'utf8').catch(() => undefined)
    return current === written
  }

  private resolve(projectId: string, path: string): string {
    const root = this.options.projectPath(projectId)
    const resolved = resolve(root, path)
    const fromRoot = relative(root, resolved)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Outside the project: ${path}`)
    }
    return resolved
  }
}

function toProjectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
