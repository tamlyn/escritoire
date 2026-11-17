import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('says why a session could not start', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project)
  const { page, close } = await launchApp(undefined, { ESCRITOIRE_CODEX_PATH: join(root, 'missing-codex') })
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await expect(page.getByText('to open a tab')).toBeVisible()
  await page.keyboard.press(`${modifier}+t`)

  await page.getByRole('button', { name: 'New Codex session' }).click()
  await expect(page.getByRole('alert')).toContainText("Couldn't find the Codex CLI")
  await expect(page.getByRole('button', { name: 'New Codex session' })).toBeEnabled()

  await close()
  await rm(root, { recursive: true, force: true })
})
