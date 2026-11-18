import { describe, expect, it } from 'vitest'
import { fileHref, findFileRefs, hrefFileRef, parseFileHref, remarkFileLinks, wholeFileRef } from './file-refs'

const paths = (text: string) => findFileRefs(text).map(({ path, line }) => (line ? `${path}:${line}` : path))

describe('findFileRefs', () => {
  it('finds paths with and without line numbers', () => {
    expect(paths('See /path/to/PLAN.md:83, then src/main/index.ts#L10-L20.')).toEqual([
      '/path/to/PLAN.md:83',
      'src/main/index.ts:10',
    ])
    expect(paths('Edited ./a.ts and ../b/c.ts:4:2 (and PLAN.md).')).toEqual(['./a.ts', '../b/c.ts:4', 'PLAN.md'])
  })

  it('skips slash commands and the middle of URLs', () => {
    expect(paths('Run /clear or visit https://example.com/a/b.html')).toEqual([])
  })

  it('offers dotted words for checking against the project', () => {
    expect(paths('Use Node.js, e.g. version 3.5')).toEqual(['Node.js', 'e.g', '3.5'])
  })
})

describe('wholeFileRef', () => {
  it('takes a code span that is only a path', () => {
    expect(wholeFileRef('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 })
    expect(wholeFileRef('pnpm test')).toBe(null)
    expect(wholeFileRef('useState')).toBe(null)
  })
})

describe('hrefFileRef', () => {
  it('reads paths, but not web links', () => {
    expect(hrefFileRef('src/a%20b.ts#L3')).toEqual({ path: 'src/a b.ts', line: 3 })
    expect(hrefFileRef('PLAN.md:83')).toEqual({ path: 'PLAN.md', line: 83 })
    expect(hrefFileRef('file:///etc/hosts')).toEqual({ path: '/etc/hosts' })
    expect(hrefFileRef('https://example.com/a.ts')).toBe(null)
    expect(hrefFileRef('mailto:someone@example.com')).toBe(null)
    expect(hrefFileRef('#heading')).toBe(null)
  })

  it('leaves out anchors and queries that are not line numbers', () => {
    expect(hrefFileRef('PLAN.md#remote-access')).toEqual({ path: 'PLAN.md' })
    expect(hrefFileRef('PLAN.md#Lists')).toEqual({ path: 'PLAN.md' })
    expect(hrefFileRef('src/a.ts?raw')).toEqual({ path: 'src/a.ts' })
    expect(hrefFileRef('src/a.ts#L3-L5')).toEqual({ path: 'src/a.ts', line: 3 })
  })
})

it('round-trips the link it makes', () => {
  expect(parseFileHref(fileHref({ path: 'a b/c&d.ts', line: 7 }, true))).toEqual({ path: 'a b/c&d.ts', line: 7, detected: true })
  expect(parseFileHref('https://example.com')).toBe(null)
})

it('links paths in text and code, but not in code blocks or existing links', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Fixed src/a.ts:3 and ' }, { type: 'inlineCode', value: 'b.ts' }] },
      { type: 'code', value: 'src/c.ts' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'd.ts' }] },
    ],
  }
  remarkFileLinks()(tree)
  expect(tree).toEqual({
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Fixed ' },
          { type: 'link', url: fileHref({ path: 'src/a.ts', line: 3 }, true), children: [{ type: 'text', value: 'src/a.ts:3' }] },
          { type: 'text', value: ' and ' },
          { type: 'link', url: fileHref({ path: 'b.ts' }, true), children: [{ type: 'inlineCode', value: 'b.ts' }] },
        ],
      },
      { type: 'code', value: 'src/c.ts' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'd.ts' }] },
    ],
  })
})
