import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Connection } from '../../shared/sql'
import { Databases } from './databases'

let root: string
let connections: Record<string, Connection>
let databases: Databases

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'escritoire-sql-'))
  const db = new DatabaseSync(join(root, 'app.db'))
  db.exec(`create table t (id integer primary key, name text, data blob);
    insert into t (name, data) values ('a', x'00ff'), ('b', null), (null, null);`)
  db.close()
  connections = { lite: { id: 'lite', name: 'Lite', type: 'sqlite', path: 'app.db' } }
  databases = new Databases({
    projectPath: () => root,
    connection: async (_projectId, id) => {
      const connection = connections[id]
      if (!connection) throw new Error('No such connection')
      return connection
    },
  })
})

afterEach(async () => {
  await databases.closeAll()
  await rm(root, { recursive: true, force: true })
})

const run = (statements: string[], connectionId = 'lite', runId: string = crypto.randomUUID()) =>
  databases.run('p', connectionId, runId, statements)

describe('SQLite', () => {
  test('returns rows as display strings', async () => {
    const [result] = await run(['select id, name, data from t order by id'])
    expect(result).toMatchObject({
      kind: 'rows',
      columns: ['id', 'name', 'data'],
      rows: [['1', 'a', "x'00ff'"], ['2', 'b', null], ['3', null, null]],
      truncated: false,
    })
  })

  test('returns columns for an empty result', async () => {
    expect((await run(['select id, name from t where 0']))[0]).toMatchObject({ kind: 'rows', columns: ['id', 'name'], rows: [] })
  })

  test('reports rows affected, and none for DDL', async () => {
    const results = await run(["update t set name = 'z' where id < 3", 'create table u (x)'])
    expect(results).toMatchObject([{ kind: 'done', affected: 2 }, { kind: 'done', affected: 0 }])
  })

  test('fetches at most 500 rows', async () => {
    const [result] = await run(['with recursive n(i) as (select 1 union all select i + 1 from n limit 1000) select i from n'])
    expect(result).toMatchObject({ kind: 'rows', truncated: true })
    expect(result!.kind === 'rows' && result!.rows.length).toBe(500)
  })

  test('stops at the first error', async () => {
    const results = await run(['select 1', 'select nope', 'select 2'])
    expect(results).toMatchObject([{ kind: 'rows' }, { kind: 'error', message: expect.stringContaining('nope') }])
  })

  test('keeps the connection between runs, so a transaction carries over', async () => {
    await run(['begin', "insert into t (name) values ('pending')"])
    expect((await run(["select count(*) from t where name = 'pending'"]))[0]).toMatchObject({ rows: [['1']] })
    await run(['rollback'])
    expect((await run(["select count(*) from t where name = 'pending'"]))[0]).toMatchObject({ rows: [['0']] })
  })

  test('cancelling stops a long query and the next run reconnects', async () => {
    const forever = 'with recursive n(i) as (select 1 union all select i + 1 from n) select count(*) from n'
    const running = run([forever, 'select 2'], 'lite', 'slow')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await databases.cancel('slow')
    expect(await running).toMatchObject([{ kind: 'error', message: expect.stringContaining('Cancelled') }])
    expect((await run(['select 1']))[0]).toMatchObject({ kind: 'rows', rows: [['1']] })
  })

  test("doesn't create a database at a missing path", async () => {
    connections.missing = { id: 'missing', name: 'Missing', type: 'sqlite', path: 'nope.db' }
    expect(await run(['select 1'], 'missing')).toMatchObject([{ kind: 'error', message: expect.stringContaining('No SQLite database') }])
  })

  test('a file that isn\'t a database fails per statement', async () => {
    await writeFile(join(root, 'text.db'), 'not sqlite')
    connections.text = { id: 'text', name: 'Text', type: 'sqlite', path: 'text.db' }
    expect(await run(['select 1'], 'text')).toMatchObject([{ kind: 'error', message: expect.stringContaining('not a database') }])
  })

  test('closing a project closes its connections', async () => {
    await run(['begin', "insert into t (name) values ('pending')"])
    await databases.closeProject('p')
    expect((await run(["select count(*) from t where name = 'pending'"]))[0]).toMatchObject({ rows: [['0']] })
  })
})

const pgUrl = process.env.ESCRITOIRE_TEST_PG_URL

describe.skipIf(!pgUrl)('Postgres', () => {
  beforeEach(() => {
    connections.pg = { id: 'pg', name: 'PG', type: 'postgres', url: pgUrl! }
  })

  test('returns Postgres text for every type', async () => {
    const [result] = await run([`select 1 as n, null as missing, '{"a":1}'::jsonb as j, array[1,2] as a, '\\x00ff'::bytea as b`], 'pg')
    expect(result).toMatchObject({ kind: 'rows', columns: ['n', 'missing', 'j', 'a', 'b'], rows: [['1', null, '{"a": 1}', '{1,2}', '\\x00ff']] })
  })

  test('reports rows affected and errors with detail', async () => {
    const results = await run(
      ['create temporary table t (id int primary key)', 'insert into t values (1), (2)', 'insert into t values (1)'],
      'pg',
    )
    expect(results).toMatchObject([
      { kind: 'done', affected: null },
      { kind: 'done', affected: 2 },
      { kind: 'error', message: expect.stringContaining('Detail: Key (id)=(1) already exists') },
    ])
  })

  test('fetches at most 500 rows', async () => {
    const [result] = await run(['select generate_series(1, 100000)'], 'pg')
    expect(result).toMatchObject({ kind: 'rows', truncated: true })
    expect(result!.kind === 'rows' && result!.rows.length).toBe(500)
  })

  test('cancelling keeps the connection', async () => {
    await run(['create temporary table kept (x int)'], 'pg')
    const running = run(['select pg_sleep(10)'], 'pg', 'slow')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await databases.cancel('slow')
    expect(await running).toMatchObject([{ kind: 'error', message: expect.stringContaining('cancel') }])
    expect(await run(['select count(*) from kept'], 'pg')).toMatchObject([{ kind: 'rows', rows: [['0']] }])
  })

  test('a connection failure is a result, and the next run tries again', async () => {
    connections.bad = { id: 'bad', name: 'Bad', type: 'postgres', url: 'postgres://nobody@127.0.0.1:1/none' }
    expect(await run(['select 1'], 'bad')).toMatchObject([{ kind: 'error' }])
    connections.bad = { ...connections.pg!, id: 'bad' }
    expect(await run(['select 1'], 'bad')).toMatchObject([{ kind: 'rows' }])
  })
})
