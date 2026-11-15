import { createServer } from 'node:net'
import { chromium, expect, test, webkit } from '@playwright/test'
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
