import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ContextWindows } from './context-windows'

test('remembers window sizes across launches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'escritoire-windows-'))
  try {
    const path = join(directory, 'context-windows.json')
    const windows = await ContextWindows.load(path)
    expect(windows.get('claude-opus-5-5')).toBeUndefined()
    windows.set('claude-opus-5-5', 1_000_000)
    await expect.poll(async () => (await ContextWindows.load(path)).get('claude-opus-5-5')).toBe(1_000_000)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
