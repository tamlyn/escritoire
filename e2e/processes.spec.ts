import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('runs package.json scripts from the gutter as supervised processes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const dataDir = join(root, 'data')
  const project = join(root, 'project')
  await mkdir(project)
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify(
      { scripts: { serve: 'echo "listening on 5000"; sleep 300', boom: 'echo "Error: kaput"; exit 2' } },
      null,
      2,
    ),
  )
  await writeFile(join(project, 'package-lock.json'), '{}')

  let { page, close } = await launchApp(dataDir)
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('combobox').fill(`${project}/`)
  await page.getByRole('option', { name: `Open ${project}/` }).click()
  await page.getByRole('tree').getByRole('treeitem', { name: 'package.json' }).click()

  await page.getByTitle('Run serve').click()
  const serveTab = page.getByRole('tab', { name: 'npm run serve' })
  await expect(serveTab).toBeVisible()
  await expect(page.locator('.xterm-rows:visible')).toContainText('listening on 5000')
  await expect(serveTab.getByLabel('Running')).toBeVisible()
  const processes = page.getByRole('region', { name: 'Processes' })
  await expect(processes.getByRole('button', { name: 'npm run serve' })).toBeVisible()

  // The run icon shows it's running, and clicking it again shows the same process.
  // (CodeMirror hides gutters from assistive technology, so these are found by title.)
  await page.getByRole('tab', { name: 'package.json' }).click()
  await page.getByTitle('serve is running: show it').click()
  await expect(page.getByRole('tab', { name: 'npm run serve' })).toHaveCount(1)
  await expect(processes.getByRole('listitem')).toHaveCount(1)

  await page.getByRole('tab', { name: 'package.json' }).click()
  await page.getByTitle('Run boom').click()
  await expect(page.getByRole('tab', { name: 'npm run boom' }).getByLabel('Failed')).toBeVisible()
  await expect(page.getByText('Failed (exit code 2)')).toBeVisible()
  await page.screenshot({ path: 'test-results/processes.png' })

  // Closing a process's tab leaves it running.
  await serveTab.click()
  await serveTab.getByRole('button').click()
  await expect(serveTab).toBeHidden()
  await expect(processes.getByRole('button', { name: 'npm run serve' }).getByLabel('Running')).toBeVisible()
  await processes.getByRole('button', { name: 'npm run serve' }).click()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()

  // After a restart the tab offers to start it again.
  await close()
  ;({ page, close } = await launchApp(dataDir))
  await page.getByRole('tab', { name: 'npm run serve' }).click()
  await expect(page.getByText('Not running.').filter({ visible: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).filter({ visible: true }).click()
  await expect(page.locator('.xterm-rows:visible')).toContainText('listening on 5000')

  await close()
  await rm(root, { recursive: true, force: true })
})
