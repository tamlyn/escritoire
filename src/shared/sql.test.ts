import { expect, test } from 'vitest'
import { connectionForFile, defaultConnectionName, splitStatements, statementsToRun } from './sql'

const texts = (sql: string) => splitStatements(sql).map((s) => sql.slice(s.from, s.to))

test('splits at semicolons and drops blank statements', () => {
  expect(texts('select 1;\n\nselect 2 ;;  \n')).toEqual(['select 1', 'select 2'])
})

test('keeps a final statement without a semicolon', () => {
  expect(texts('select 1;\nselect 2')).toEqual(['select 1', 'select 2'])
})

test('ignores semicolons in quotes and identifiers', () => {
  expect(texts(`select 'a;''b'; select "x;y", \`z;\`;`)).toEqual([`select 'a;''b'`, 'select "x;y", `z;`'])
})

test('ignores semicolons in comments and leaves out leading comments', () => {
  expect(texts('-- first; still a comment\nselect 1 /* a; /* nested; */ b; */ + 1;\n-- trailing;')).toEqual([
    'select 1 /* a; /* nested; */ b; */ + 1',
  ])
})

test('ignores semicolons in dollar quoting', () => {
  const fn = 'create function f() returns int as $body$ begin return 1; end; $body$ language plpgsql'
  expect(texts(`${fn}; do $$ begin perform 1; end $$;`)).toEqual([fn, 'do $$ begin perform 1; end $$'])
})

test('treats positional parameters as ordinary code', () => {
  expect(texts('select $1; select a$b$ from t;')).toEqual(['select $1', 'select a$b$ from t'])
})

test('an unterminated quote runs to the end', () => {
  expect(texts("select 'oops; select 2")).toEqual(["select 'oops; select 2"])
})

const sql = 'select 1;\nselect 2;\n\nselect 3'
const run = (from: number, to = from) => statementsToRun(sql, from, to).map((s) => sql.slice(s.from, s.to))

test('runs the statement under the cursor', () => {
  expect(run(0)).toEqual(['select 1'])
  expect(run(sql.indexOf('2'))).toEqual(['select 2'])
  expect(run(sql.length)).toEqual(['select 3'])
})

test('a cursor after a semicolon on the same line runs that statement', () => {
  expect(run(sql.indexOf(';') + 1)).toEqual(['select 1'])
})

test('a cursor on a blank line runs the next statement', () => {
  expect(run(sql.indexOf('\n\n') + 1)).toEqual(['select 3'])
})

test('a selection runs every statement it touches', () => {
  expect(run(sql.indexOf('1'), sql.indexOf('2'))).toEqual(['select 1', 'select 2'])
})

test('nothing to run in an empty file', () => {
  expect(statementsToRun('  -- nothing\n', 0, 0)).toEqual([])
})

test('a file uses its chosen connection, else the only one', () => {
  const a = { id: 'a', name: 'A', type: 'sqlite' as const, path: 'a.db' }
  const b = { id: 'b', name: 'B', type: 'sqlite' as const, path: 'b.db' }
  expect(connectionForFile({ connections: [a], files: {} }, 'q.sql')).toBe(a)
  expect(connectionForFile({ connections: [a, b], files: {} }, 'q.sql')).toBeUndefined()
  expect(connectionForFile({ connections: [a, b], files: { 'q.sql': 'b' } }, 'q.sql')).toBe(b)
  expect(connectionForFile({ connections: [a], files: { 'q.sql': 'gone' } }, 'q.sql')).toBe(a)
})

test('names a connection after its database and host, or its file', () => {
  const pg = (url: string) => defaultConnectionName({ type: 'postgres', url })
  expect(pg('postgres://me@db.example.com:5432/app')).toBe('app@db.example.com')
  expect(pg('postgresql://me@localhost')).toBe('me@localhost')
  expect(pg('postgres:///app')).toBe('app@localhost')
  expect(pg('not a url')).toBe('')
  expect(defaultConnectionName({ type: 'sqlite', path: 'data/app.db' })).toBe('app.db')
})
