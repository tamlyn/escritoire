import { link, lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import watcher, { type AsyncSubscription } from '@parcel/watcher'
import type { DirectoryEntry, FileContent, FilesChanged, WriteResult } from '../shared/files'

const hiddenNames = new Set(['.git', '.DS_Store'])
// node_modules can hold tens of thousands of directories, which on Linux means
// as many inotify watches. The tree still lists them; they just don't refresh
// live. Globs, because the watcher resolves plain names against the root only.
const unwatched = ['**/.git/**', '**/node_modules/**']
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const maxFileSize = 5 * 1024 * 1024
const maxListedFiles = 20_000
const scratchDirectory = '.scratch'

type Options = {
  projectPath: (projectId: string) => string
  send: (payload: FilesChanged) => void
  /** Moves an absolute path to the OS trash, so a deletion can be undone. */
  trash: (path: string) => Promise<void>
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

  private resolving: Promise<void> = Promise.resolve()
  private readonly writes = new Map<string, Promise<WriteResult>>()

  constructor(private readonly options: Options) {}

  async listDirectory(projectId: string, path: string): Promise<DirectoryEntry[]> {
    const directory = await this.resolve(projectId, path)
    const entries = await readdir(directory, { withFileTypes: true })
    const listed = await Promise.all(
      entries
        .filter((entry) => !hiddenNames.has(entry.name))
        .map(async (entry) => {
          if (entry.isSymbolicLink()) {
            try { await this.resolve(projectId, path ? `${path}/${entry.name}` : entry.name) }
            catch { return null }
          }
          return ({
          name: entry.name,
          path: path ? `${path}/${entry.name}` : entry.name,
          isDirectory:
            entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(directory, entry.name)))),
        })}),
    )
    return listed.filter((entry) => entry !== null).sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    )
  }

  /** Every file under the project, for one that isn't in git; capped, since it may be huge. */
  async listAllFiles(projectId: string): Promise<string[]> {
    const root = this.options.projectPath(projectId)
    const files: string[] = []
    const pending = ['']
    while (pending.length > 0 && files.length < maxListedFiles) {
      const directory = pending.shift()!
      const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (hiddenNames.has(entry.name) || entry.name === 'node_modules') continue
        if (entry.isSymbolicLink()) {
          try { await this.resolve(projectId, directory ? `${directory}/${entry.name}` : entry.name) }
          catch { continue }
        }
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) pending.push(path)
        else files.push(path)
      }
    }
    return files.slice(0, maxListedFiles)
  }

  async readFile(projectId: string, path: string): Promise<FileContent> {
    const file = await this.resolve(projectId, path)
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
  async writeFile(projectId: string, path: string, text: string, expected?: string): Promise<WriteResult> {
    const resolution = this.resolving.then(() => this.resolve(projectId, path))
    this.resolving = resolution.then(() => {}, () => {})
    const file = await resolution
    const write = (this.writes.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await this.resolve(projectId, path)
      if (expected !== undefined) {
        const current = await readFile(file, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (current === undefined) return 'missing' as const
        if (current !== expected) throw new Error('File changed on disk. Reopen the tab to load it; copy your edits first.')
      }
      return this.writeQueued(file, text)
    })
    this.writes.set(file, write)
    const cleanup = () => { if (this.writes.get(file) === write) this.writes.delete(file) }
    void write.then(cleanup, cleanup)
    return write
  }

  private async writeQueued(file: string, text: string): Promise<WriteResult> {
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
      await handle.writeFile(data)
      await handle.truncate(data.length)
    } finally {
      await handle.close()
    }
    return 'saved'
  }

  /** Creates an empty file, and any directories it needs. Never replaces an existing file. */
  async createFile(projectId: string, path: string): Promise<void> {
    if (!(await this.createIfAbsent(projectId, path))) throw new Error(`${path} already exists`)
  }

  /** Creates an empty file in the scratch directory, named for when it was made. */
  async createScratchFile(projectId: string, extension: string, now = new Date()): Promise<string> {
    if (!/^[\w+-]+(\.[\w+-]+)*$/.test(extension)) throw new Error(`Not a file extension: ${extension}`)
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    for (let n = 1; ; n++) {
      const path = `${scratchDirectory}/${stamp}${n === 1 ? '' : `-${n}`}.${extension}`
      if (await this.createIfAbsent(projectId, path)) return path
    }
  }

  private async createIfAbsent(projectId: string, path: string): Promise<boolean> {
    const file = await this.resolveEntry(projectId, path)
    await mkdir(dirname(file), { recursive: true })
    try {
      await writeFile(file, '', { flag: 'wx' })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }

  /** Moves a file or directory, creating directories as needed. Never replaces an existing entry. */
  async rename(projectId: string, from: string, to: string): Promise<void> {
    const source = await this.resolveEntry(projectId, from)
    const target = await this.resolveEntry(projectId, to)
    const stats = await lstat(source)
    const existing = await lstat(target).catch(() => undefined)
    // On a case-insensitive file system, a change of case finds the source itself.
    if (existing && existing.ino !== stats.ino) throw new Error(`${to} already exists`)
    await mkdir(dirname(target), { recursive: true })
    // rename replaces a file that appears after the check; link refuses to. A
    // directory can't be linked, but rename only replaces an empty one.
    const linked =
      !existing &&
      stats.isFile() &&
      (await link(source, target).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'EEXIST') throw new Error(`${to} already exists`)
          // Some file systems have no hard links.
          return false
        },
      ))
    if (linked) await unlink(source)
    else await rename(source, target)
  }

  async delete(projectId: string, path: string): Promise<void> {
    await this.options.trash(await this.resolveEntry(projectId, path))
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

  private async resolve(projectId: string, path: string): Promise<string> {
    const root = await realpath(this.options.projectPath(projectId))
    const resolved = await realpathAllowingMissing(resolve(root, path))
    const fromRoot = relative(root, resolved)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Outside the project: ${path}`)
    }
    return resolved
  }

  /** The entry itself rather than what it links to, so a symlink is renamed or deleted, not its target. */
  private async resolveEntry(projectId: string, path: string): Promise<string> {
    const name = basename(path)
    if (!name || name === '.' || name === '..') throw new Error(`Not a file name: ${path}`)
    return join(await this.resolve(projectId, dirname(path)), name)
  }
}

/** The real path of the deepest existing ancestor, followed by the rest of the path. */
async function realpathAllowingMissing(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    const parent = dirname(path)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path) throw error
    return join(await realpathAllowingMissing(parent), basename(path))
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
