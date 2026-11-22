import { expect, test } from 'vitest'
import { matchLine, queryRegExp, type TextQuery } from './search'

const query = (text: string, options: Partial<TextQuery> = {}): TextQuery => ({
  text,
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...options,
})

const matches = (q: TextQuery, text: string) => matchLine(text, 1, queryRegExp(q)!)?.ranges ?? []

test('matches literal text, ignoring case unless asked', () => {
  expect(matches(query('a.b'), 'A.B axb a.b')).toEqual([[0, 3], [8, 11]])
  expect(matches(query('a.b', { caseSensitive: true }), 'A.B a.b')).toEqual([[4, 7]])
})

test('matches whole words, including ones that start or end with punctuation', () => {
  expect(matches(query('cat', { wholeWord: true }), 'cat concat cats cat.')).toEqual([[0, 3], [16, 19]])
  expect(matches(query('.x', { wholeWord: true }), 'a.x .x .xy')).toEqual([[1, 3], [4, 6]])
})

test('matches regular expressions, skipping empty matches', () => {
  expect(matches(query('o+', { regexp: true }), 'foo bo')).toEqual([[1, 3], [5, 6]])
  expect(matches(query('x*', { regexp: true }), 'axb')).toEqual([[1, 2]])
})

test('has no expression for an empty or invalid query', () => {
  expect(queryRegExp(query(''))).toBeNull()
  expect(queryRegExp(query('(', { regexp: true }))).toBeNull()
  expect(queryRegExp(query('('))).not.toBeNull()
})

test('shows the line without its indent', () => {
  expect(matchLine('    const x = 1', 3, queryRegExp(query('x'))!)).toEqual({
    line: 3,
    from: 10,
    to: 11,
    preview: 'const x = 1',
    ranges: [[6, 7]],
  })
})

test('clips a long line around its first match', () => {
  const text = `${'a'.repeat(300)}needle${'b'.repeat(300)}`
  const match = matchLine(text, 1, queryRegExp(query('needle'))!)!
  expect(match.from).toBe(300)
  expect(match.preview.startsWith('…')).toBe(true)
  expect(match.preview.endsWith('…')).toBe(true)
  const [[from, to]] = match.ranges as [[number, number]]
  expect(match.preview.slice(from, to)).toBe('needle')
})
