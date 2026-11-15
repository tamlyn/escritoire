import { expect, test } from 'vitest'
import { newFileTarget, normalizePath } from './new-file'

test('a bare extension makes a scratch file', () => {
  expect(newFileTarget('.sql')).toEqual({ kind: 'scratch', extension: 'sql' })
  expect(newFileTarget(' .test.ts ')).toEqual({ kind: 'scratch', extension: 'test.ts' })
})

test('anything else is a path in the project', () => {
  expect(newFileTarget('notes.md')).toEqual({ kind: 'path', path: 'notes.md' })
  expect(newFileTarget('docs//notes/./auth.md')).toEqual({ kind: 'path', path: 'docs/notes/auth.md' })
  expect(newFileTarget('./.env')).toEqual({ kind: 'path', path: '.env' })
  expect(newFileTarget('config/.env')).toEqual({ kind: 'path', path: 'config/.env' })
  expect(newFileTarget('src/../notes.md')).toEqual({ kind: 'path', path: 'notes.md' })
})

test('a directory, nothing or a path outside the project is not a file', () => {
  expect(newFileTarget('')).toBeNull()
  expect(newFileTarget('docs/')).toBeNull()
  expect(normalizePath('./')).toBeNull()
  expect(normalizePath('src/..')).toBeNull()
  expect(normalizePath('../notes.md')).toBeNull()
  expect(normalizePath('src/../../notes.md')).toBeNull()
})
