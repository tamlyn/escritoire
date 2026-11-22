import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type ApiConnection, connectApi } from '../src/shared/api-client'
import { fakeCodex, openProject, send, startCodexSession } from './agent'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('gives another client its own active project, and moves the window off a project it closes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))
  const { page, close } = await launchApp()

  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('combobox').fill(`${root}/alpha/`)
  await page.getByRole('option', { name: `Open ${root}/alpha/` }).click()
  await expect(page.getByRole('banner')).toHaveText('alpha')

  // A second client, as a phone will be, using the window's own connection.
  const other = connectApi(page.evaluate<ApiConnection>('window.desktop.apiConnection()'))
  const alpha = await other.api.getState()
  expect(alpha.projects.find((p) => p.id === alpha.activeProjectId)?.name).toBe('alpha')

  const beta = await other.api.openProject(join(root, 'beta'))
  expect(beta.projects.find((p) => p.id === beta.activeProjectId)?.name).toBe('beta')
  await page.keyboard.press(`${modifier}+Shift+p`)
  await expect(page.getByRole('option', { name: /^beta/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('banner')).toHaveText('alpha')

  await other.api.closeProject(alpha.activeProjectId!)
  await expect(page.getByRole('banner')).toHaveText('beta')

  other.close()
  await close()
  await rm(root, { recursive: true, force: true })
})

test('keeps the session tabs of a project another client closes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const alpha = join(root, 'alpha')
  await mkdir(alpha)
  await mkdir(join(root, 'beta'))
  const agent = fakeCodex(join(root, 'codex'))
  const { page, close } = await launchApp(join(root, 'data'), agent.env)
  await openProject(page, alpha)
  await startCodexSession(page)
  await send(page, 'hello')
  await expect(page.getByText('Reply to: hello')).toBeVisible()

  const other = connectApi(page.evaluate<ApiConnection>('window.desktop.apiConnection()'))
  const state = await other.api.getState()
  await other.api.openProject(join(root, 'beta'))
  // Its sessions stop before the window hears the project closed.
  await other.api.closeProject(state.activeProjectId!)
  await expect(page.getByRole('banner')).toContainText('beta')

  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('option', { name: /^alpha/ }).click()
  await expect(page.getByRole('banner')).toContainText('alpha')
  await expect(page.getByRole('tab', { name: 'hello' })).toBeVisible()

  other.close()
  await close()
  await rm(root, { recursive: true, force: true })
})
