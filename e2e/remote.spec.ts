import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, devices, expect, test, webkit } from '@playwright/test'
import { fakeCodex, openProject } from './agent'
import { launchApp } from './app'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

for (const [name, browserType] of [['Chromium', chromium], ['WebKit', webkit]] as const) {
  test(`pairs ${name} with a code, serves it the app, and revokes it`, async () => {
    const { page, close } = await launchApp()
    const port = await freePort()

    await page.getByRole('button', { name: 'Remote access' }).click()
    await page.getByLabel('Port').fill(String(port))
    await page.getByRole('button', { name: 'Turn on' }).click()
    await expect(page.getByText(`tailscale serve --bg ${port}`)).toBeVisible()
    await page.getByRole('button', { name: 'Pair a device' }).click()
    const code = await page.getByLabel('Pairing code').textContent()

    const browser = await browserType.launch()
    const remote = await browser.newPage()
    await remote.goto(`http://127.0.0.1:${port}/`)
    await remote.getByLabel('Pairing code').fill(code!)
    await remote.getByRole('button', { name: 'Pair' }).click()

    await expect(remote.getByRole('banner')).toContainText('No project')
    await expect(remote.getByRole('button', { name: 'Remote access' })).toHaveCount(0)
    await expect(page.getByText('Connected')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Remote access' })).toHaveText('1')

    // Kept across reloads.
    await remote.reload()
    await expect(remote.getByRole('banner')).toContainText('No project')

    await page.getByRole('button', { name: 'Remote access' }).click()
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
  for (const name of ['alpha', 'beta']) {
    await page.keyboard.press(`${modifier}+o`)
    await page.getByRole('combobox').fill(`${root}/${name}/`)
    await page.getByRole('option', { name: `Open ${root}/${name}/` }).click()
    await expect(page.getByRole('banner')).toContainText(name)
  }

  const port = await freePort()
  await page.getByRole('button', { name: 'Remote access' }).click()
  await page.getByLabel('Port').fill(String(port))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByRole('button', { name: 'Pair a device' }).click()
  const code = await page.getByLabel('Pairing code').textContent()

  const browser = await chromium.launch()
  const remote = await browser.newPage()
  await remote.goto(`http://127.0.0.1:${port}/`)
  await remote.getByLabel('Pairing code').fill(code!)
  await remote.getByRole('button', { name: 'Pair' }).click()
  await expect(remote.getByRole('banner')).toContainText('beta')

  await remote.getByRole('banner').getByRole('button', { name: 'beta' }).click()
  await remote.getByRole('option', { name: /^alpha/ }).click()
  await expect(remote.getByRole('banner')).toContainText('alpha')
  // The desktop was last to be active in beta until the browser moved, so make it the latest again.
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${modifier}+o`)
  await page.getByRole('option', { name: /^beta/ }).click()
  await expect(page.getByRole('banner')).toContainText('beta')

  await page.getByRole('button', { name: 'Remote access' }).click()
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
  const agent = fakeCodex(join(root, 'codex'))
  const { page, close } = await launchApp(join(root, 'data'), agent.env)
  await openProject(page, join(root, 'alpha'))
  await openProject(page, join(root, 'beta'))

  const port = await freePort()
  await page.getByRole('button', { name: 'Remote access' }).click()
  await page.getByLabel('Port').fill(String(port))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByRole('button', { name: 'Pair a device' }).click()
  const code = await page.getByLabel('Pairing code').textContent()

  const browser = await webkit.launch()
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  const phone = await context.newPage()
  await phone.goto(`http://127.0.0.1:${port}/`)
  await phone.getByLabel('Pairing code').fill(code!)
  await phone.getByRole('button', { name: 'Pair' }).click()

  await expect(phone.getByRole('button', { name: 'New Claude session' })).toBeVisible()
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
  await expect(phone.getByRole('button', { name: 'Back to sessions' })).toBeVisible()
  await expect(phone.locator('[data-workspace]')).toHaveCount(0)

  await phone.getByRole('button', { name: 'Back to sessions' }).click()
  await expect(phone.getByRole('button', { name: /^code/ })).toBeVisible()

  await browser.close()
  await close()
  await rm(root, { recursive: true, force: true })
})
