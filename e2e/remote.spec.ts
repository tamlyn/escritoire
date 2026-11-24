import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, devices, expect, test, webkit } from '@playwright/test'
import { fakeCodex, openProject, send, startCodexSession } from './agent'
import { launchApp } from './app'
import { openRemoteAccess, pair, turnOnRemoteAccess } from './remote'

for (const [name, browserType] of [['Chromium', chromium], ['WebKit', webkit]] as const) {
  test(`pairs ${name} with a code, serves it the app, and revokes it`, async () => {
    const { page, close } = await launchApp()

    const port = await turnOnRemoteAccess(page)
    await expect(page.getByText(`tailscale serve --bg ${port}`)).toBeVisible()

    const browser = await browserType.launch()
    const remote = await browser.newPage()
    await pair(page, remote, port)

    await expect(remote.getByRole('banner')).toContainText('No project')
    await remote.getByRole('button', { name: 'Menu' }).click()
    await expect(remote.getByRole('menuitem', { name: 'About Escritoire' })).toBeVisible()
    await expect(remote.getByRole('menuitem', { name: 'Remote access' })).toHaveCount(0)
    await expect(page.getByText('Connected')).toBeVisible()
    await page.keyboard.press('Escape')

    // Kept across reloads.
    await remote.reload()
    await expect(remote.getByRole('banner')).toContainText('No project')

    await openRemoteAccess(page)
    await page.getByRole('button', { name: 'Revoke' }).click()
    await expect(remote.getByRole('heading', { name: 'Pair with Escritoire' })).toBeVisible()

    await browser.close()
    await close()
  })
}

test('a paired browser recovers in its own project when the connection returns', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))
  const { page, close } = await launchApp()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await openProject(page, join(root, 'alpha'))
  await openProject(page, join(root, 'beta'))

  const port = await turnOnRemoteAccess(page)
  const browser = await chromium.launch()
  const remote = await browser.newPage()
  await pair(page, remote, port)
  await expect(remote.getByRole('banner')).toContainText('beta')

  await remote.getByRole('banner').getByRole('button', { name: 'beta' }).click()
  await remote.getByRole('option', { name: /^alpha/ }).click()
  await expect(remote.getByRole('banner')).toContainText('alpha')
  // The desktop was last to be active in beta until the browser moved, so make it the latest again.
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('option', { name: /^beta/ }).click()
  await expect(page.getByRole('banner')).toContainText('beta')

  await openRemoteAccess(page)
  await page.getByRole('button', { name: 'Turn off' }).click()
  await expect(remote.getByRole('status')).toHaveText('Reconnecting…')
  await expect(remote.getByRole('banner')).toContainText('alpha')

  await page.getByLabel('Port').fill(String(port))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await expect(remote.getByRole('status')).toHaveCount(0, { timeout: 15_000 })
  await expect(remote.getByRole('banner')).toContainText('alpha')

  await browser.close()
  await close()
  await rm(root, { recursive: true, force: true })
})

test('a phone drives a session from its own layout', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  await mkdir(join(root, 'alpha'))
  await mkdir(join(root, 'beta'))
  await writeFile(join(root, 'alpha', 'notes.txt'), 'some notes')
  const agent = fakeCodex(join(root, 'codex'))
  const { page, close } = await launchApp(join(root, 'data'), agent.env)
  await openProject(page, join(root, 'alpha'))
  await openProject(page, join(root, 'beta'))
  await startCodexSession(page)
  await send(page, 'from the desk')
  await expect(page.getByRole('tab', { name: 'from the desk' })).toBeVisible()

  const port = await turnOnRemoteAccess(page)
  const browser = await webkit.launch()
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  const phone = await context.newPage()
  await pair(page, phone, port)

  await expect(phone.getByRole('button', { name: 'New Claude session' })).toBeVisible()
  const manifest = await context.request.get(`http://127.0.0.1:${port}/manifest.webmanifest`)
  expect(manifest.headers()['content-type']).toBe('application/manifest+json')
  expect((await context.request.get(`http://127.0.0.1:${port}/sw.js`)).ok()).toBe(true)
  await phone.getByRole('button', { name: 'Inbox' }).click()
  await expect(phone.getByRole('menuitem', { name: 'Add to Home Screen to get notifications' })).toBeVisible()
  await phone.keyboard.press('Escape')
  await expect(phone.locator('[data-workspace]')).toHaveCount(0)

  await phone.getByRole('banner').getByRole('button', { name: 'beta' }).click()
  await phone.getByRole('option', { name: /^alpha/ }).click()
  await expect(phone.getByRole('banner')).toContainText('alpha')

  await phone.getByRole('button', { name: 'New Codex session' }).click()
  const composer = phone.getByPlaceholder(/Message agent/)
  await composer.fill('first line')
  await composer.press('Enter')
  await expect(composer).toHaveValue('first line\n')
  await composer.fill('code\n\n```js\nconst long = "' + 'x'.repeat(300) + '"\n```')
  await phone.getByRole('button', { name: 'Send' }).click()
  await expect(phone.getByText('Reply to: code')).toBeVisible()

  // Long lines scroll inside their block rather than widening the page.
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const log = phone.getByRole('log')
  expect(await log.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)

  // Turned on its side, a phone keeps the phone layout and so stays away from the desktop's saved layout.
  await phone.setViewportSize({ width: 844, height: 390 })
  await expect(phone.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(phone.locator('[data-workspace]')).toHaveCount(0)

  await phone.getByRole('button', { name: 'Back' }).click()
  await expect(phone.getByRole('button', { name: /^code/ })).toBeVisible()
  await phone.setViewportSize({ width: 390, height: 664 })

  // A file from the switcher, edited in a view of its own.
  await phone.getByRole('banner').getByRole('button', { name: 'alpha' }).click()
  await phone.getByRole('combobox').fill('notes')
  await phone.getByRole('option', { name: 'notes.txt' }).click()
  await expect(phone.getByText('some notes')).toBeVisible()
  await phone.getByRole('button', { name: 'Back' }).click()

  // And from the file tree, which going back from the file returns to.
  await phone.getByRole('button', { name: 'Files' }).click()
  await phone.getByRole('treeitem', { name: 'notes.txt' }).click()
  await expect(phone.getByText('some notes')).toBeVisible()
  await phone.getByRole('button', { name: 'Back' }).click()
  await expect(phone.getByRole('treeitem', { name: 'notes.txt' })).toBeVisible()
  await phone.getByRole('button', { name: 'Back' }).click()

  // A terminal the phone starts, with the keys a phone's keyboard lacks, which keeps running until closed.
  await phone.getByRole('button', { name: 'New terminal' }).click()
  await expect(phone.getByRole('button', { name: 'Ctrl' })).toBeVisible()
  await phone.locator('.xterm').click()
  await phone.keyboard.type('echo from-the-phone')
  await phone.keyboard.press('Enter')
  await expect(phone.locator('.xterm-rows')).toContainText('from-the-phone')
  await phone.getByRole('button', { name: 'Back' }).click()
  await phone.getByRole('button', { name: 'Terminal 1', exact: true }).click()
  await expect(phone.locator('.xterm-rows')).toContainText('from-the-phone')
  await phone.getByRole('button', { name: 'Back' }).click()
  await phone.getByRole('button', { name: 'Close Terminal 1' }).click()
  await expect(phone.getByRole('button', { name: 'Terminal 1', exact: true })).toHaveCount(0)

  // Closing a session stops it, as closing its desktop tab would.
  await phone.getByRole('button', { name: /^Close code/ }).click()
  await expect(phone.getByRole('button', { name: /^Close code/ })).toHaveCount(0)

  // A session with a desktop tab loses the tab too.
  await phone.getByRole('banner').getByRole('button', { name: 'alpha' }).click()
  await phone.getByRole('option', { name: /^beta/ }).click()
  await phone.getByRole('button', { name: 'Close from the desk' }).click()
  await expect(page.getByRole('tab', { name: 'from the desk' })).toHaveCount(0)

  await browser.close()
  await close()
  await rm(root, { recursive: true, force: true })
})

test('publishes remote access with Tailscale when its command is found', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const { page, close } = await launchApp(join(root, 'data'), {
    ESCRITOIRE_TAILSCALE_PATH: join(import.meta.dirname, 'fake-tailscale.mjs'),
    FAKE_TAILSCALE_STATE: join(root, 'tailscale.json'),
  })

  await turnOnRemoteAccess(page)
  await page.getByRole('button', { name: 'Publish with Tailscale' }).click()
  await expect(page.getByText('https://phone-test.example.ts.net')).toBeVisible()

  await close()
  await rm(root, { recursive: true, force: true })
})
