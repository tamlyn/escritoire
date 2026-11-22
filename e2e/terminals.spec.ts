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
  await page.keyboard.press(`${modifier}+Shift+p`)
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

test('refits a terminal split into a smaller tabset and follows the system theme', async () => {
  const project = join(await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-'))), 'project')
  await mkdir(project)
  const { page, close } = await launchApp()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await expect(page.getByText('to open a tab')).toBeVisible()
  await page.keyboard.press(`${modifier}+t`)
  await page.getByRole('button', { name: 'New terminal' }).click()
  const terminal = page.locator('.xterm:visible')
  await expect(terminal).toBeVisible()

  // Drag a new tab onto the bottom edge of the terminal's tabset, splitting it.
  await page.keyboard.press(`${modifier}+t`)
  const tab = (await page.getByRole('tab', { name: 'New tab' }).boundingBox())!
  const panels = (await page.locator('[data-tab-panels]').first().boundingBox())!
  await page.mouse.move(tab.x + 20, tab.y + 10)
  await page.mouse.down()
  await page.mouse.move(panels.x + panels.width / 2, panels.y + panels.height / 2, { steps: 10 })
  await page.mouse.move(panels.x + panels.width / 2, panels.y + panels.height - 30, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('tab', { name: 'Terminal' }).click()

  // xterm's own scrollbar keeps its old height unless the terminal refits once rendering resumes.
  await expect(page.getByRole('tab', { name: 'New tab' })).toBeVisible()
  await expect
    .poll(() => terminal.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBe(0)
  expect((await terminal.boundingBox())!.height).toBeLessThan(panels.height * 0.75)

  const textColor = () => page.locator('.xterm-rows:visible').evaluate((element) => getComputedStyle(element).color)
  const light = await textColor()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(textColor).not.toBe(light)

  await close()
  await rm(join(project, '..'), { recursive: true, force: true })
})
