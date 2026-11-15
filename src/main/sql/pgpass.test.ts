import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { lookupPassword, pgpassKey, savePassword, separatePassword } from './pgpass'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'escritoire-pgpass-'))
  path = join(dir, '.pgpass')
  vi.stubEnv('PGPASSWORD', undefined)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

const key = { host: 'db.example.com', port: '5432', database: 'app', user: 'me' }

test('derives what pg connects to from the URL', () => {
  expect(pgpassKey('postgres://me@db.example.com:6543/app')).toEqual({ host: 'db.example.com', port: '6543', database: 'app', user: 'me' })
  expect(pgpassKey('postgres://me@db.example.com')).toMatchObject({ port: '5432', database: 'me' })
})

test('looks up the first matching line, with wildcards and escapes', async () => {
  await writeFile(
    path,
    '# comment\nother:5432:app:me:wrong\ndb.example.com:*:app:me:pa\\:ss\\\\word\n*:*:*:*:fallback\n',
    { mode: 0o600 },
  )
  expect(await lookupPassword(key, path)).toBe('pa:ss\\word')
  expect(await lookupPassword({ ...key, user: 'someone' }, path)).toBe('fallback')
})

test('PGPASSWORD wins, and a missing file has no password', async () => {
  expect(await lookupPassword(key, path)).toBeUndefined()
  vi.stubEnv('PGPASSWORD', 'from-env')
  expect(await lookupPassword(key, path)).toBe('from-env')
})

test('refuses a file others can read, as libpq ignores it', async () => {
  await writeFile(path, '*:*:*:*:secret\n')
  await chmod(path, 0o644)
  await expect(lookupPassword(key, path)).rejects.toThrow('chmod 600')
})

test('saving creates a private file, puts the line first and replaces the same connection', async () => {
  await savePassword(key, 'first', path)
  expect((await stat(path)).mode & 0o777).toBe(0o600)

  await writeFile(path, `${await readFile(path, 'utf8')}# keep me\n*:*:*:*:fallback\n`, { mode: 0o600 })
  await savePassword({ ...key, database: 'other' }, 'second', path)
  await savePassword(key, 'with:colon', path)
  expect(await readFile(path, 'utf8')).toBe(
    'db.example.com:5432:app:me:with\\:colon\ndb.example.com:5432:other:me:second\n# keep me\n*:*:*:*:fallback\n',
  )
  expect(await lookupPassword(key, path)).toBe('with:colon')
})

test('takes a password out of the URL, writing it to the file only when saved', async () => {
  const inUser = separatePassword('postgres://me:p%40ss@db.example.com/app?sslmode=require', path)
  const inQuery = separatePassword('postgres://me@db.example.com/other?password=q&sslmode=require', path)
  expect(inUser.url).toBe('postgres://me@db.example.com/app?sslmode=require')
  expect(inQuery.url).toBe('postgres://me@db.example.com/other?sslmode=require')
  await expect(stat(path)).rejects.toThrow()
  await inUser.save()
  await inQuery.save()
  expect(await lookupPassword(key, path)).toBe('p@ss')
  expect(await lookupPassword({ ...key, database: 'other' }, path)).toBe('q')
})

test('leaves a URL without a password alone, and writes nothing', async () => {
  const plain = separatePassword('postgres://me@db.example.com/app', path)
  const notUrl = separatePassword('not a url', path)
  expect(plain.url).toBe('postgres://me@db.example.com/app')
  expect(notUrl.url).toBe('not a url')
  await plain.save()
  await notUrl.save()
  await expect(stat(path)).rejects.toThrow()
})
