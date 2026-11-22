import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { expect, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

type TurnStart = { threadId: string; approvalPolicy?: string; effort?: string | null; input: { type: string; text?: string }[] }

/** The scripted agent in `fake-codex.mjs`, keeping its threads in `dir`. */
export function fakeCodex(dir: string) {
  const turnStarts = (): TurnStart[] => {
    const log = join(dir, 'requests.jsonl')
    if (!existsSync(log)) return []
    return readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; params: TurnStart })
      .filter((request) => request.method === 'turn/start')
      .map((request) => request.params)
  }
  return {
    env: { ESCRITOIRE_CODEX_PATH: join(import.meta.dirname, 'fake-codex.mjs'), FAKE_CODEX_DIR: dir },
    /** Lets the turn started by a `hold` message finish. */
    release: () => writeFileSync(join(dir, 'release'), ''),
    turnStarts,
    /** Each message the agent has actually been sent, in order. */
    messages: () => turnStarts().map((turn) => turn.input.find((input) => input.type === 'text')?.text),
  }
}

export async function openProject(page: Page, path: string): Promise<void> {
  await page.keyboard.press(`${modifier}+Shift+p`)
  await page.getByRole('combobox').fill(`${path}/`)
  await page.getByRole('option', { name: `Open ${path}/` }).click()
  // The previous project's empty workspace says the same until this one replaces it.
  await expect(page.getByRole('banner')).toContainText(basename(path))
  await expect(page.getByText('to open a tab')).toBeVisible()
}

export async function startCodexSession(page: Page) {
  await page.keyboard.press(`${modifier}+t`)
  await page.getByRole('button', { name: 'New Codex session' }).click()
  const composer = page.getByPlaceholder(/Message agent/)
  await expect(composer).toBeVisible()
  return composer
}

export async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox').filter({ visible: true }).last()
  await composer.fill(text)
  await composer.press('Enter')
}
