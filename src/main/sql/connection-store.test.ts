import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { Connection } from '../../shared/sql'
import { ConnectionStore } from './connection-store'

let dataDir: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'escritoire-connections-'))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const lite: Connection = { id: 'a', name: 'Lite', type: 'sqlite', path: 'app.db' }
const pg: Connection = { id: 'b', name: 'PG', type: 'postgres', url: 'postgres://me@localhost/app' }

test('saves connections and file choices across restarts', async () => {
  const store = new ConnectionStore(dataDir)
  await store.save('p', lite)
  await store.save('p', pg)
  await store.save('p', { ...lite, name: 'Renamed' })
  await store.setFileConnection('p', 'q.sql', 'b')

  expect(await new ConnectionStore(dataDir).get('p')).toEqual({
    connections: [{ ...lite, name: 'Renamed' }, pg],
    files: { 'q.sql': 'b' },
  })
  expect(await store.get('other')).toEqual({ connections: [], files: {} })
})

test('deleting a connection forgets the files that used it', async () => {
  const store = new ConnectionStore(dataDir)
  await store.save('p', lite)
  await store.setFileConnection('p', 'q.sql', 'a')
  expect(await store.delete('p', 'a')).toEqual({ connections: [], files: {} })
})

test('never stores a password, as a guard behind moving it to ~/.pgpass', async () => {
  const store = new ConnectionStore(dataDir)
  await expect(store.save('p', { ...pg, url: 'postgres://me:secret@localhost/app' })).rejects.toThrow('~/.pgpass')
  await expect(store.save('p', { ...pg, url: 'postgres://me@localhost/app?password=secret' })).rejects.toThrow('~/.pgpass')
  await expect(store.save('p', { ...pg, url: 'mysql://me@localhost/app' })).rejects.toThrow('postgres://')
  expect((await store.get('p')).connections).toEqual([])
})

test('removing the project removes its connections', async () => {
  const store = new ConnectionStore(dataDir)
  await store.save('p', lite)
  await store.deleteProject('p')
  expect(await new ConnectionStore(dataDir).get('p')).toEqual({ connections: [], files: {} })
})
