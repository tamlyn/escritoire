import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('opens projects, keeps tabs per project, and restores them after restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))

  let { app, page, close } = await launchApp(dataDir)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir)

  async function openProject(name: string) {
    await page.keyboard.press(`${modifier}+o`)
    await page.getByRole('combobox').fill(`${root}/${name}/`)
    await page.getByRole('option', { name: `Open ${root}/${name}/` }).click()
    await expect(page.getByRole('banner')).toHaveText(name)
    await page.locator('[data-workspace]').waitFor()
  }

  await openProject('alpha')
  await page.keyboard.press(`${modifier}+t`)
  await page.keyboard.press(`${modifier}+t`)
  await expect(page.getByRole('tab')).toHaveCount(2)

  await openProject('beta')
  await expect(page.getByRole('tab')).toHaveCount(0)

  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('option', { name: /^alpha/ }).click()
  await expect(page.getByRole('banner')).toHaveText('alpha')
  await expect(page.getByRole('tab')).toHaveCount(2)

  await close()
  ;({ page, close } = await launchApp(dataDir))
  await expect(page.getByRole('banner')).toHaveText('alpha')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/projects.png' })

  await close()
  await rm(root, { recursive: true, force: true })
})

test("shows what is going on in other projects in the switcher", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))
  await writeFile(join(root, 'alpha', 'package.json'), JSON.stringify({ scripts: { boom: 'exit 2' } }, null, 2))
  await writeFile(join(root, 'alpha', 'package-lock.json'), '{}')

  const { page, close } = await launchApp()
  async function openProject(name: string) {
    await page.keyboard.press(`${modifier}+o`)
    await page.getByRole('combobox').fill(`${root}/${name}/`)
    await page.getByRole('option', { name: `Open ${root}/${name}/` }).click()
    await expect(page.getByRole('banner')).toHaveText(name)
  }

  await openProject('alpha')
  await page.getByRole('tree').getByRole('treeitem', { name: 'package.json' }).click()
  await page.getByTitle('Run boom').click()
  await expect(page.getByRole('tab', { name: 'npm run boom' }).getByLabel('Failed')).toBeVisible()
  await openProject('beta')

  await page.keyboard.press(`${modifier}+o`)
  const options = page.getByRole('option')
  await expect(options.first()).toContainText('alpha')
  await expect(options.first().getByLabel('1 crashed')).toBeVisible()
  await expect(options.last()).toContainText('current')
  await page.screenshot({ path: 'test-results/projects-activity.png' })

  await close()
  await rm(root, { recursive: true, force: true })
})
