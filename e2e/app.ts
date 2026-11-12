import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export type RunningApp = { app: ElectronApplication; page: Page; close: () => Promise<void> }

/** Launches the built app with its own data directory, so tests never touch real state. */
export async function launchApp(userDataDir?: string): Promise<RunningApp> {
  const dataDir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dataDir}`] })
  const page = await app.firstWindow()
  await page.getByRole('banner').waitFor()
  return {
    app,
    page,
    close: async () => {
      await app.close()
      if (!userDataDir) await rm(dataDir, { recursive: true, force: true })
    },
  }
}
