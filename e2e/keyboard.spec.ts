import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('opens files, moves between tabs and runs actions from the keyboard', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'a.md'), '# A\n')
  await writeFile(join(project, 'b.md'), '# B\n')

  const { page, close } = await launchApp(join(root, 'data'))
  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await page.locator('[data-workspace]').waitFor()

  // Only files, so the project's own name doesn't match.
  for (const name of ['a.md', 'b.md']) {
    await page.keyboard.press(`${modifier}+Shift+o`)
    await page.getByRole('combobox').fill(name)
    await expect(page.getByRole('option')).toHaveText([name])
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name, selected: true })).toBeVisible()
  }

  await page.locator('.cm-content:visible').click()
  await page.keyboard.press(`${modifier}+Home`)
  await page.keyboard.press('End')
  await page.keyboard.press(`${modifier}+Shift+BracketLeft`)
  await expect(page.getByRole('tab', { name: 'a.md', selected: true })).toBeVisible()
  await page.keyboard.press(`${modifier}+Shift+BracketLeft`)
  await expect(page.getByRole('tab', { name: 'b.md', selected: true })).toBeVisible()
  // Focus and the cursor come back with the tab.
  await expect(page.locator('.cm-content:visible')).toBeFocused()
  await page.keyboard.type('!')
  await expect.poll(() => readFile(join(project, 'b.md'), 'utf8')).toBe('# B!\n')
  await page.keyboard.press(`${modifier}+Shift+BracketRight`)
  await expect(page.getByRole('tab', { name: 'a.md', selected: true })).toBeVisible()
  // Also when the tab is chosen with the mouse.
  await page.getByRole('tab', { name: 'b.md' }).click()
  await expect(page.locator('.cm-content:visible')).toBeFocused()
  await page.getByRole('tab', { name: 'a.md' }).click()

  // A palette's shortcut swaps to it from another; other shortcuts wait until the dialog closes.
  await page.keyboard.press(`${modifier}+Shift+o`)
  await expect(page.getByPlaceholder('Open a file, or type a full path…')).toBeFocused()
  await page.keyboard.press(`${modifier}+t`)
  await page.keyboard.press(`${modifier}+Shift+a`)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByPlaceholder('Search actions…')).toBeFocused()
  await page.getByRole('combobox').fill('new terminal')
  await page.screenshot({ path: 'test-results/actions.png' })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Terminal', selected: true })).toBeVisible()
  // The ⌘T pressed in the file palette opened nothing.
  await expect(page.getByRole('tab')).toHaveCount(3)
  // The terminal leaves the app's shortcuts to the app.
  await page.locator('.xterm:visible').click()
  await page.keyboard.press(`${modifier}+Shift+BracketRight`)
  await expect(page.getByRole('tab', { name: 'a.md', selected: true })).toBeVisible()

  await page.keyboard.press(`${modifier}+t`)
  await expect(page.getByRole('button', { name: 'New Claude session' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'New terminal' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('button', { name: 'New Codex session' })).toBeFocused()

  await close()
  await rm(root, { recursive: true, force: true })
})
