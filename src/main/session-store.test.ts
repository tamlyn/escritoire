import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { SessionStore } from './session-store'

test('ignores saves for a project after it is removed', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'escritoire-store-'))
  const store = new SessionStore(dataDir)
  const record = { agent: 'claude' as const, title: 'T', draft: '', lastSeenAt: 0, lastTurnEndedAt: 0 }
  await store.put('p1', 's1', record)

  await store.deleteProject('p1')
  await store.put('p1', 's1', record)

  expect(await readdir(join(dataDir, 'sessions'))).toEqual([])
})
