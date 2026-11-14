import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { drainPersistence, writeJson } from './json-file'

test('handled write failures do not reject a discarded cleanup promise; later writes recover', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'escritoire-json-'))
  try {
    const parent = join(directory, 'parent')
    await writeFile(parent, 'not a directory')
    await expect(writeJson(join(parent, 'state.json'), {})).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await rm(parent)
    await writeJson(join(parent, 'state.json'), { saved: true })
    await drainPersistence()
    expect(JSON.parse(await readFile(join(parent, 'state.json'), 'utf8'))).toEqual({ saved: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
