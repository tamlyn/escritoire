import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('summarises changes and history, and follows changes made elsewhere', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: project })
  git('init', '-q', '-b', 'main')
  await writeFile(join(project, 'app.js'), 'const a = 1\nconst b = 2\n')
  git('add', '.')
  git('commit', '-qm', 'First commit')
  await writeFile(join(project, 'app.js'), 'const a = 1\nconst b = 3\n')
  await writeFile(join(project, 'notes.md'), 'one\ntwo\nthree\n')

  const { page, close } = await launchApp(join(root, 'data'))
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()

  await page.getByRole('button', { name: /main.*2 files changed/ }).click()
  const changes = page.getByRole('region', { name: 'Changes' })
  await expect(changes.getByRole('button', { name: /app\.js.*\+1 −1/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Untracked' }).getByRole('button', { name: /notes\.md.*\+3/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'History' })).toContainText('First commit')
  await page.screenshot({ path: 'test-results/git.png' })

  await changes.getByRole('button', { name: /app\.js/ }).click()
  await expect(page.getByRole('tab', { name: /app\.js/ })).toBeVisible()
  await expect(page.locator('.cm-deletedChunk:visible')).toContainText('const b = 2')
  await expect(page.locator('.cm-content:visible')).toContainText('const b = 3')

  // An edit made elsewhere updates the open diff.
  await writeFile(join(project, 'app.js'), 'const a = 1\nconst b = 4\n')
  await expect(page.locator('.cm-content:visible')).toContainText('const b = 4')
  await page.screenshot({ path: 'test-results/git-diff.png' })

  // So does staging and committing outside the IDE, which only changes the git directory.
  git('add', '.')
  await expect(page.getByText('No changes.')).toBeVisible()
  git('commit', '-qm', 'Second commit')
  await page.getByRole('tab', { name: 'Git' }).click()
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Second commit')
  await expect(page.getByText('No changes.').filter({ visible: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /main.*No changes/ })).toBeVisible()

  await close()
  await rm(root, { recursive: true, force: true })
})
