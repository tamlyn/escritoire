import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type ElectronApplication, type Page, test } from '@playwright/test'
import { fakeCodex, openProject, send, startCodexSession } from './agent'
import { launchApp } from './app'

async function setUp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const alpha = join(root, 'alpha')
  const beta = join(root, 'beta')
  await mkdir(alpha)
  await mkdir(beta)
  return { root, alpha, beta, dataDir: join(root, 'data'), agent: fakeCodex(join(root, 'codex')) }
}

const inbox = (page: Page) => page.getByRole('button', { name: /needs? you$/ })
const badge = (app: ElectronApplication) => app.evaluate(({ app }) => app.getBadgeCount())
const notifications = (app: ElectronApplication) =>
  app.evaluate(() =>
    (globalThis as unknown as { e2eNotifications: Electron.Notification[] }).e2eNotifications.map(({ title, body }) => ({ title, body })),
  )

test('tells the user when a session in another project finishes', async () => {
  const { root, alpha, beta, dataDir, agent } = await setUp()
  const { app, page, close } = await launchApp(dataDir, agent.env)
  await openProject(page, alpha)
  await startCodexSession(page)
  await send(page, 'hold')
  await expect(page.getByText('Working…')).toBeVisible()
  await openProject(page, beta)
  await expect(inbox(page)).toHaveCount(0)

  agent.release()
  await expect(inbox(page)).toHaveAccessibleName('1 session needs you')
  await expect.poll(() => badge(app)).toBe(1)
  await expect.poll(() => notifications(app)).toEqual([{ title: 'alpha', body: 'hold has finished' }])

  await inbox(page).click()
  await page.getByRole('menuitem', { name: /hold.*alpha/ }).click()
  await expect(page.getByRole('banner')).toContainText('alpha')
  await expect(page.getByText('Reply to: hold')).toBeVisible()
  await expect(inbox(page)).toHaveCount(0)
  await expect.poll(() => badge(app)).toBe(0)

  await close()
  await rm(root, { recursive: true, force: true })
})

test('shows a session waiting for input, and clicking its notification goes to it', async () => {
  const { root, alpha, beta, dataDir, agent } = await setUp()
  const { app, page, close } = await launchApp(dataDir, agent.env)
  await openProject(page, alpha)
  await startCodexSession(page)
  await send(page, 'permission')
  await expect(page.getByText('Delete the build directory?')).toBeVisible()
  await expect(inbox(page)).toHaveAccessibleName('1 session needs you')
  await openProject(page, beta)

  await expect(inbox(page)).toHaveAccessibleName('1 session needs you')
  await inbox(page).click()
  await expect(page.getByRole('menuitem', { name: /permission.*alpha/ }).getByLabel('Waiting for input')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => notifications(app)).toEqual([{ title: 'alpha', body: 'permission needs your input' }])

  await app.evaluate(() => {
    (globalThis as unknown as { e2eNotifications: Electron.Notification[] }).e2eNotifications[0]!.emit('click')
  })
  await expect(page.getByRole('banner')).toContainText('alpha')
  await page.getByRole('button', { name: 'Allow once' }).click()
  await expect(page.getByText('Decision: accept')).toBeVisible()
  await expect(inbox(page)).toHaveCount(0)

  await close()
  await rm(root, { recursive: true, force: true })
})

test('keeps a session unread across a restart until it is seen', async () => {
  const { root, alpha, beta, dataDir, agent } = await setUp()
  let { page, close } = await launchApp(dataDir, agent.env)
  await openProject(page, alpha)
  await startCodexSession(page)
  await send(page, 'hold')
  await expect(page.getByText('Working…')).toBeVisible()
  await openProject(page, beta)
  agent.release()
  await expect(inbox(page)).toBeVisible()

  await close()
  ;({ page, close } = await launchApp(dataDir, agent.env))
  await expect(page.getByRole('banner')).toContainText('beta')
  await expect(inbox(page)).toHaveAccessibleName('1 session needs you')
  await inbox(page).click()
  await page.getByRole('menuitem', { name: /hold.*alpha/ }).click()
  await expect(page.getByText('Reply to: hold')).toBeVisible()
  await expect(inbox(page)).toHaveCount(0)

  await close()
  ;({ page, close } = await launchApp(dataDir, agent.env))
  await expect(page.getByText('Reply to: hold')).toBeVisible()
  await expect(inbox(page)).toHaveCount(0)

  await close()
  await rm(root, { recursive: true, force: true })
})
