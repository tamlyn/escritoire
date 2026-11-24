import { createServer } from 'node:net'
import type { Page } from '@playwright/test'

export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function openRemoteAccess(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Remote access' }).click()
}

export async function turnOnRemoteAccess(page: Page): Promise<number> {
  const port = await freePort()
  await openRemoteAccess(page)
  await page.getByLabel('Port').fill(String(port))
  await page.getByRole('button', { name: 'Turn on' }).click()
  return port
}

/** With the remote access dialog open on the desktop. */
export async function pair(page: Page, remote: Page, port: number): Promise<void> {
  await page.getByRole('button', { name: 'Pair a device' }).click()
  const code = await page.getByLabel('Pairing code').textContent()
  await remote.goto(`http://127.0.0.1:${port}/`)
  await remote.getByLabel('Pairing code').fill(code!)
  await remote.getByRole('button', { name: 'Pair' }).click()
}
