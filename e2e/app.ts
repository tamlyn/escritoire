import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export type RunningApp = { app: ElectronApplication; page: Page; close: () => Promise<void> }

/**
 * Launches the built app in the background, with its own data directory and
 * Claude Code configuration, so tests never touch real state or take focus.
 */
export async function launchApp(userDataDir?: string, env?: Record<string, string>): Promise<RunningApp> {
  const dataDir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const app = await electron.launch({
    args: ['-r', join(import.meta.dirname, 'background.cjs'), '.', `--user-data-dir=${dataDir}`],
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dataDir, 'claude'), ...env } as Record<string, string>,
  })
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
