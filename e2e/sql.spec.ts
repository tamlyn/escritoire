import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('runs statements from a SQL file on a saved connection and shows the results', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project)
  const db = new DatabaseSync(join(project, 'app.db'))
  db.exec(`create table users (id integer primary key, email text);
    insert into users (email) values ('a@example.com'), (null);`)
  db.close()
  await writeFile(
    join(project, 'queries.sql'),
    "select 1 as one;\n\nselect id, email from users order by id;\n\nupdate users set email = 'b@example.com' where email is null;\n",
  )

  const { page, close } = await launchApp(join(root, 'data'))
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'queries.sql' }).click()
  const editor = page.locator('.cm-content:visible')
  await expect(editor).toContainText('select 1 as one')

  // With no connection yet, running asks for one; it's then used for the file.
  await editor.getByText('select id, email from users').click()
  await page.keyboard.press(`${modifier}+Enter`)
  const dialog = page.getByRole('dialog')
  // The name follows the file until it's given one.
  await dialog.getByLabel('Database file').fill('app.db')
  await expect(dialog.getByLabel('Name')).toHaveValue('app.db')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTitle('Connection to run on')).toHaveText('app.db')

  // The statement under the cursor.
  await editor.getByText('select id, email from users').click()
  await page.keyboard.press(`${modifier}+Enter`)
  const table = page.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(['', 'id', 'email'])
  await expect(table.getByRole('row')).toHaveText(['idemail', '11a@example.com', '22NULL'])
  await expect(page.getByText('2 rows ·')).toBeVisible()
  // Mod-Enter ran the statement rather than inserting a line.
  await expect(editor.locator('.cm-line')).toHaveCount(6)

  // A selection runs each statement it touches, with a result for each.
  await editor.getByText('select id, email from users').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: 'Run' }).click()
  const results = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: /^update users/ }) })
  await expect(results.getByRole('tab')).toHaveCount(2)
  await expect(page.getByText('1 row affected')).toBeVisible()
  await results.getByRole('tab', { name: /^select id/ }).click()
  await expect(table.getByRole('row')).toHaveCount(3)

  // Errors show in place of a result.
  await writeFile(join(project, 'queries.sql'), 'select nope from users;\n')
  await expect(editor).toContainText('select nope')
  await editor.click()
  await page.keyboard.press(`${modifier}+Enter`)
  await expect(page.getByRole('alert')).toContainText('no such column: nope')
  await page.screenshot({ path: 'test-results/sql.png' })

  // A Postgres connection is named after its database and host. Not saved, as
  // that would move the password to the real ~/.pgpass.
  await page.getByTitle('Connection to run on').click()
  await page.getByRole('menuitem', { name: 'New connection…' }).click()
  await dialog.getByRole('radio', { name: 'Postgres' }).click()
  await dialog.getByLabel('URL').fill('postgres://me@db.example.com/app')
  await expect(dialog.getByLabel('Name')).toHaveValue('app@db.example.com')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await close()
  await rm(root, { recursive: true, force: true })
})
