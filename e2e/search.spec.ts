import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('finds in a file and across the project', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src', 'app.ts'), 'const needle = 1\nconst Needle = 2\n// a needle in a haystack\n')
  await writeFile(join(project, 'notes.md'), '# Notes\n\nThe needles are here.\n')

  const { page, close } = await launchApp(join(root, 'data'))
  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await page.locator('[data-workspace]').waitFor()
  await page.keyboard.press(`${modifier}+Shift+o`)
  await page.getByRole('combobox').fill('app.ts')
  await expect(page.getByRole('option')).toHaveText(['src/app.ts'])
  await page.keyboard.press('Enter')

  // Find in the file: typing selects the first match, Enter moves on, ⌥C matches case.
  await page.locator('.cm-content:visible').click()
  await page.keyboard.press(`${modifier}+f`)
  await page.keyboard.type('needle')
  const status = page.locator('.cm-panels').getByText(/\d+\/\d+|results/)
  await expect(status).toHaveText('1/3')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('2/3')
  await page.keyboard.press('Alt+c')
  await expect(page.getByRole('button', { name: /Match case/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(status).toHaveText(/\/2$/)
  // ⌘R shows the replace row and ⌘F hides it again, rather than reloading the window.
  const replace = page.getByPlaceholder('Replace')
  await page.keyboard.press(`${modifier}+r`)
  await expect(replace).toBeVisible()
  await page.screenshot({ path: 'test-results/find-in-file.png' })
  await page.keyboard.press(`${modifier}+f`)
  await expect(replace).toHaveCount(0)
  await expect(status).toHaveText(/\/2$/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-panels')).toHaveCount(0)

  // Find in files starts from the editor's selection.
  await page.keyboard.press(`${modifier}+Shift+f`)
  const input = page.getByPlaceholder('Find in files…')
  await expect(input).toHaveValue('needle')
  await expect(page.getByRole('option')).toHaveCount(4)
  await page.screenshot({ path: 'test-results/find-in-files.png' })
  await input.fill('needles')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByText('1 matching line in 1 file')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'notes.md', selected: true })).toBeVisible()
  await expect
    .poll(() => page.locator('.cm-editor:visible').evaluate(() => getSelection()?.toString()))
    .toBe('needles')

  await page.keyboard.press(`${modifier}+Shift+f`)
  await page.keyboard.press('Alt+x')
  await page.keyboard.type('(')
  await expect(page.getByText('Not a valid regular expression.')).toBeVisible()

  await close()
  await rm(root, { recursive: true, force: true })
})
