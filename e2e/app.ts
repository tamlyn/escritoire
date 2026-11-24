import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { removeLauncherEnv } from '../src/main/shell-env'

export type RunningApp = { app: ElectronApplication; page: Page; close: () => Promise<void> }

/**
 * Launches the built app in the background, with its own data directory and
 * Claude Code configuration, so tests never touch real state or take focus.
 */
export async function launchApp(userDataDir?: string, env?: Record<string, string>): Promise<RunningApp> {
  const dataDir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  // Run from a shell inside `pnpm dev`, the app would otherwise act as a dev build.
  const inherited = { ...process.env }
  removeLauncherEnv(inherited)
  const app = await electron.launch({
    args: ['-r', join(import.meta.dirname, 'background.cjs'), '.', `--user-data-dir=${dataDir}`],
    // No real `tailscale` command, so tests can't publish anything to the user's tailnet.
    env: { ...inherited, CLAUDE_CONFIG_DIR: join(dataDir, 'claude'), ESCRITOIRE_TAILSCALE_PATH: '/nonexistent', ...env } as Record<string, string>,
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
