import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeDirectory, expandHome } from './paths'

let root: string

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-test-')))
  for (const name of ['apple', 'Apricot', 'banana', '.hidden']) await mkdir(join(root, name))
  await writeFile(join(root, 'apple.txt'), '')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('completeDirectory', () => {
  it('lists visible subdirectories after a trailing slash', async () => {
    expect(await completeDirectory(`${root}/`)).toEqual(
      ['apple', 'Apricot', 'banana'].map((name) => join(root, name)),
    )
  })

  it('matches a partial name case-insensitively, ignoring files', async () => {
    expect(await completeDirectory(join(root, 'ap'))).toEqual([join(root, 'apple'), join(root, 'Apricot')])
  })

  it('includes hidden directories only when the partial name starts with a dot', async () => {
    expect(await completeDirectory(`${root}/.`)).toEqual([join(root, '.hidden')])
  })

  it('returns nothing for a missing directory', async () => {
    expect(await completeDirectory(join(root, 'missing', 'x'))).toEqual([])
  })
})

describe('expandHome', () => {
  it('expands a leading tilde only', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/x')).toBe(join(homedir(), 'x'))
    expect(expandHome('/a/~/b')).toBe('/a/~/b')
  })
})
