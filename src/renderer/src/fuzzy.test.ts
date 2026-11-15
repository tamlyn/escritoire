import { describe, expect, it } from 'vitest'
import { fuzzyFinder } from './fuzzy'

describe('fuzzyFinder', () => {
  const files = ['src/main/index.ts', 'src/renderer/src/main.tsx', 'docs/maintenance.md', 'package.json', 'Makefile']
  const find = fuzzyFinder(files, { path: (path) => path, limit: 3 })
  const paths = (query: string) => find(query).map((match) => match.item)

  it('prefers matches in the file name', () => {
    const ranked = paths('main')
    expect(ranked.indexOf('src/renderer/src/main.tsx')).toBeLessThan(ranked.indexOf('src/main/index.ts'))
  })

  it('matches characters in order', () => {
    expect(paths('pkjs')).toEqual(['package.json'])
    expect(paths('jspk')).toEqual([])
  })

  it('ignores case unless the query has capitals', () => {
    expect(paths('Ma')).toEqual(['Makefile'])
    expect(paths('ma')).toContain('Makefile')
  })

  it('returns the first items, in order, for an empty query', () => {
    expect(paths('')).toEqual(files.slice(0, 3))
  })

  it('gives the positions of the matched characters', () => {
    expect([...find('pkjs')[0]!.positions].sort((a, b) => a - b)).toEqual([0, 3, 8, 9])
  })
})
