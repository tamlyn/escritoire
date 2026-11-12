import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const pendingWrites = new Map<string, Promise<void>>()

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Writes via a temporary file and rename so a crash can't leave a truncated
 * file. Writes to the same path are queued so an older write never lands last.
 */
export function writeJson(path: string, value: unknown): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve()
  const write = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporaryPath = `${path}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, JSON.stringify(value, null, 2))
      await rename(temporaryPath, path)
    })
  pendingWrites.set(path, write)
  void write.finally(() => {
    if (pendingWrites.get(path) === write) pendingWrites.delete(path)
  })
  return write
}

export function deleteJson(path: string): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve()
  const deletion = previous.catch(() => {}).then(() => rm(path, { force: true }))
  pendingWrites.set(path, deletion)
  return deletion
}
