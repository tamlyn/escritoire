import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type ApiConnection, connectApi } from '../src/shared/api-client'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('gives another client its own active project, and moves the window off a project it closes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))
  const { page, close } = await launchApp()

  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${root}/alpha/`)
  await page.getByRole('option', { name: `Open ${root}/alpha/` }).click()
  await expect(page.getByRole('banner')).toHaveText('alpha')

  // A second client, as a phone will be, using the window's own connection.
  const other = connectApi(page.evaluate<ApiConnection>('window.desktop.apiConnection()'))
  const alpha = await other.api.getState()
  expect(alpha.projects.find((p) => p.id === alpha.activeProjectId)?.name).toBe('alpha')

  const beta = await other.api.openProject(join(root, 'beta'))
  expect(beta.projects.find((p) => p.id === beta.activeProjectId)?.name).toBe('beta')
  await page.keyboard.press(`${modifier}+o`)
  await expect(page.getByRole('option', { name: /^beta/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('banner')).toHaveText('alpha')

  await other.api.closeProject(alpha.activeProjectId!)
  await expect(page.getByRole('banner')).toHaveText('beta')

  other.close()
  await close()
  await rm(root, { recursive: true, force: true })
})
