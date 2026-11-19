import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('browses, edits and autosaves files, and shows changes made on disk', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  const project = join(root, 'project')
  await mkdir(join(project, 'config'), { recursive: true })
  await writeFile(join(project, 'config', 'app.json'), '{\n  "port": 3000\n}\n')
  await writeFile(join(project, 'README.md'), '# Hello\n')

  let { page, close } = await launchApp(dataDir)
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()

  const tree = page.getByRole('tree', { name: 'Files' })
  await expect(tree.getByRole('treeitem')).toHaveText(['config', 'README.md'])
  await tree.getByRole('treeitem', { name: 'config' }).click()
  await tree.getByRole('treeitem', { name: 'app.json' }).click()
  await expect(page.getByRole('tab', { name: 'app.json' })).toBeVisible()

  const editor = page.locator('.cm-content:visible')
  await expect(editor).toContainText('"port": 3000')

  // Autosave.
  await editor.click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.type('// edited')
  await expect.poll(() => readFile(join(project, 'config', 'app.json'), 'utf8')).toContain('// edited')

  // A change on disk, as an agent would make, updates the editor.
  await page.locator('[role=tree]').click()
  await writeFile(join(project, 'config', 'app.json'), '{\n  "port": 4000\n}\n')
  await expect(editor).toContainText('"port": 4000')

  // New files appear in the tree.
  await writeFile(join(project, 'config', 'new.yaml'), 'a: 1\n')
  await expect(tree.getByRole('treeitem', { name: 'new.yaml' })).toBeVisible()
  await page.screenshot({ path: 'test-results/files.png' })

  // Windows line endings survive an edit.
  await writeFile(join(project, 'windows.ini'), 'a=1\r\nb=2\r\n')
  await tree.getByRole('treeitem', { name: 'windows.ini' }).click()
  await page.locator('.cm-content:visible').click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.type('c=3')
  await expect.poll(() => readFile(join(project, 'windows.ini'), 'utf8')).toBe('a=1\r\nb=2\r\nc=3')

  // A failed save is shown, not lost.
  await chmod(join(project, 'windows.ini'), 0o444)
  await page.keyboard.type('\nd=4')
  await expect(page.getByRole('alert')).toContainText("Couldn't save")
  await chmod(join(project, 'windows.ini'), 0o644)
  await page.keyboard.type('\ne=5')
  await expect(page.getByRole('alert')).toBeHidden()
  await expect.poll(() => readFile(join(project, 'windows.ini'), 'utf8')).toBe('a=1\r\nb=2\r\nc=3\r\nd=4\r\ne=5')
  await page.getByRole('tab', { name: 'app.json' }).click()

  // The file tab and expanded directories come back after a restart.
  await close()
  ;({ page, close } = await launchApp(dataDir))
  await expect(page.locator('.cm-content:visible')).toContainText('"port": 4000')
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'app.json' })).toBeVisible()

  await close()
  await rm(root, { recursive: true, force: true })
})

test('creates scratch and named files, and renames them', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(join(project, 'notes'), { recursive: true })
  await writeFile(join(project, 'notes', 'auth.md'), '# Auth\n')

  const { page, close } = await launchApp(join(root, 'data'))
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  const tree = page.getByRole('tree', { name: 'Files' })
  await expect(tree.getByRole('treeitem', { name: 'notes' })).toBeVisible()

  // A bare extension makes a scratch file.
  await page.keyboard.press(`${modifier}+n`)
  const input = page.getByRole('textbox', { name: 'Path' })
  await input.fill('.sql')
  await expect(page.getByRole('dialog')).toContainText('Creates a scratch .sql file')
  await input.press('Enter')
  await expect(page.getByRole('tab', { name: /^\d{4}-\d\d-\d\d-\d{4}\.sql/ })).toBeVisible()
  expect(await readdir(join(project, '.scratch'))).toEqual([expect.stringMatching(/\.sql$/)])

  // From the tree, in the clicked directory, with the directories it needs.
  await tree.getByRole('treeitem', { name: 'notes' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New file…' }).click()
  await expect(input).toHaveValue('notes/')
  await expect(input).toBeFocused()
  await page.keyboard.type('deep/todo.md')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'todo.md' })).toBeVisible()
  expect(await readFile(join(project, 'notes', 'deep', 'todo.md'), 'utf8')).toBe('')

  // Renaming selects the name, and its open tab follows it.
  await tree.getByRole('treeitem', { name: 'notes' }).click()
  await tree.getByRole('treeitem', { name: 'auth.md' }).click()
  await expect(page.getByRole('tab', { name: 'auth.md' })).toBeVisible()
  await tree.getByRole('treeitem', { name: 'auth.md' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename…' }).click()
  await expect(input).toBeFocused()
  await page.keyboard.type('login')
  await expect(input).toHaveValue('notes/login.md')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'login.md' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'auth.md' })).toBeHidden()
  await expect(page.locator('.cm-content:visible')).toContainText('# Auth')
  expect(await readFile(join(project, 'notes', 'login.md'), 'utf8')).toBe('# Auth\n')
  await page.screenshot({ path: 'test-results/new-files.png' })

  await close()
  await rm(root, { recursive: true, force: true })
})

test('opens a project file from the switcher by fuzzy name', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  const project = join(root, 'project')
  await mkdir(join(project, 'src', 'server'), { recursive: true })
  await writeFile(join(project, 'src', 'server', 'routes.ts'), 'export const routes = []\n')
  await writeFile(join(project, 'README.md'), '# Hello\n')

  const { page, close } = await launchApp(dataDir)
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await page.locator('[data-workspace]').waitFor()

  await page.keyboard.press(`${modifier}+o`)
  // The dot keeps the project's random temp path from matching and taking the highlight.
  await page.getByRole('combobox').fill('srvrt.ts')
  await expect(page.getByRole('group', { name: 'Files' }).getByRole('option')).toHaveText(['src/server/routes.ts'])
  await page.screenshot({ path: 'test-results/open-file.png' })
  await page.keyboard.press('Enter')

  await expect(page.getByRole('tab', { name: 'routes.ts' })).toBeVisible()
  await expect(page.locator('.cm-content:visible')).toContainText('export const routes')

  await close()
  await rm(root, { recursive: true, force: true })
})

test('closes the selected tab with the close shortcut', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  const project = join(root, 'project')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'a.md'), '# A\n')
  await writeFile(join(project, 'b.md'), '# B\n')

  const { page, close } = await launchApp(dataDir)
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()

  const tree = page.getByRole('tree', { name: 'Files' })
  await tree.getByRole('treeitem', { name: 'a.md' }).click()
  await tree.getByRole('treeitem', { name: 'b.md' }).click()
  await expect(page.getByRole('tab', { name: 'b.md' })).toBeVisible()

  await page.locator('.cm-content:visible').click()
  await page.keyboard.press(`${modifier}+w`)
  await expect(page.getByRole('tab', { name: 'b.md' })).toBeHidden()
  await expect(page.getByRole('tab', { name: 'a.md' })).toBeVisible()

  await close()
  await rm(root, { recursive: true, force: true })
})
