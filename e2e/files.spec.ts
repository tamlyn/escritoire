import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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

  // A change on disk, as an agent would make, updates the editor and marks the file.
  await page.locator('[role=tree]').click()
  await writeFile(join(project, 'config', 'app.json'), '{\n  "port": 4000\n}\n')
  await expect(editor).toContainText('"port": 4000')
  await expect(page.getByRole('tab', { name: /app\.json/ }).getByLabel('Changed just now')).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'config' })).toHaveAttribute('title', /changed just now/)

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
