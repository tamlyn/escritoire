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
  const serialized = JSON.stringify(value, null, 2)
  return queue(path, async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, serialized)
    await rename(temporaryPath, path)
  })
}

export function deleteJson(path: string): Promise<void> {
  return queue(path, () => rm(path, { force: true }))
}

function queue(path: string, change: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve()
  const queued = previous.catch(() => {}).then(change)
  pendingWrites.set(path, queued)
  const cleanup = () => { if (pendingWrites.get(path) === queued) pendingWrites.delete(path) }
  void queued.then(cleanup, cleanup)
  return queued
}
