import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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

test("offers the project's slash commands in the composer", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(join(project, '.claude', 'commands'), { recursive: true })
  await writeFile(join(project, '.claude', 'commands', 'greet.md'), '---\ndescription: Say hello\n---\nSay hello.\n')
  const { page, close } = await launchApp()
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await expect(page.getByText('to open a tab')).toBeVisible()
  await page.keyboard.press(`${modifier}+t`)

  await page.getByRole('button', { name: 'New Claude session' }).click()
  const composer = page.getByPlaceholder(/Message agent/)
  await composer.fill('/gre')
  await expect(page.getByRole('button', { name: /\/greet\s*Say hello/ })).toBeVisible()
  await composer.press('Enter')
  await expect(composer).toHaveValue('/greet ')

  await close()
  await rm(root, { recursive: true, force: true })
})

test('clears the transcript and follows the new session on /clear', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project)
  const { page, close } = await launchApp()
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await expect(page.getByText('to open a tab')).toBeVisible()
  await page.keyboard.press(`${modifier}+t`)

  await page.getByRole('button', { name: 'New Claude session' }).click()
  const composer = page.getByPlaceholder(/Message agent/)
  const firstTabId = await page.getByRole('tab', { name: 'New session' }).getAttribute('data-tab-id')
  // Claude Code runs /clear itself, without asking the model.
  await composer.fill('/clear')
  await composer.press('Enter')
  await expect(page.locator(`[data-tab-id="${firstTabId}"]`)).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'New session', selected: true })).toBeVisible()
  await expect(page.getByText('Working…')).toBeHidden()
  await expect(page.getByText('/clear', { exact: true })).toBeHidden()

  await close()
  await rm(root, { recursive: true, force: true })
})
