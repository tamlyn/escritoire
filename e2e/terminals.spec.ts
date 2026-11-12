import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('runs a shell in a terminal tab and restores its scrollback after a restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  const project = join(root, 'project')
  await mkdir(join(project, 'sub'), { recursive: true })

  let { page, close } = await launchApp(dataDir)
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()

  await expect(page.getByText('to open a tab')).toBeVisible()
  await page.keyboard.press(`${modifier}+t`)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await expect(page.getByRole('tab', { name: 'Terminal' })).toBeVisible()

  let screen = page.locator('.xterm-rows:visible')
  // The terminal takes focus when shown.
  await page.keyboard.type('cd sub && echo "answer $((40 + 2))"\n')
  await expect(screen).toContainText('answer 42')

  // Another tab and back: the shell keeps running and the screen is kept.
  await page.keyboard.press(`${modifier}+t`)
  await page.getByRole('tab', { name: 'Terminal' }).click()
  await expect(screen).toContainText('answer 42')
  await page.screenshot({ path: 'test-results/terminal.png' })

  await close()
  ;({ page, close } = await launchApp(dataDir))
  screen = page.locator('.xterm-rows:visible')
  await expect(screen).toContainText('answer 42')
  await expect(screen).toContainText('Restored')
  await page.locator('.xterm:visible').click()
  await page.keyboard.type('pwd\n')
  await expect(screen).toContainText(join(project, 'sub'))

  await close()
  await rm(root, { recursive: true, force: true })
})
