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
})

test('a directory or nothing is not a file', () => {
  expect(newFileTarget('')).toBeNull()
  expect(newFileTarget('docs/')).toBeNull()
  expect(normalizePath('./')).toBeNull()
})
