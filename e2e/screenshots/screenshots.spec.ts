import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devices, expect, type Locator, type Page, test, webkit } from '@playwright/test'
import { fakeCodex, openProject, send } from '../agent'
import { launchApp, type RunningApp } from '../app'
import { fakeClaude } from '../claude'
import { pair, turnOnRemoteAccess } from '../remote'
import { codexPrompt, codexScript, createDemoProject, prompts, script } from './demo-project'

const output = join(import.meta.dirname, '../../docs/screenshots')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

type Stage = RunningApp

/** The app at a fixed size with the demo project open, then cleaned up. */
async function onStage(run: (stage: Stage) => Promise<void>, size = { width: 1440, height: 900 }): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-screenshots-')))
  const project = join(root, 'tidepool')
  await createDemoProject(project)
  const agent = fakeClaude(join(root, 'claude-fake'), script)
  const codex = fakeCodex(join(root, 'codex'))
  codex.script(codexScript)
  const codexEnv = { ...codex.env, FAKE_CODEX_MODEL_NAME: 'GPT-6-Astra' }
  const app = await launchApp(join(root, 'data'), { ...agent.env, ...codexEnv, ...(await neutralShell(root)) })
  try {
    await app.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), size)
    await app.page.emulateMedia({ colorScheme: 'light' })
    if (process.platform === 'darwin') await drawTrafficLights(app.page)
    await openProject(app.page, project)
    await app.page.getByRole('tree').getByRole('treeitem', { name: 'src', exact: true }).click()
    await run(app)
  } finally {
    agent.release()
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
}

/** A shell with a plain prompt, so terminals don't show the user's own. */
async function neutralShell(root: string): Promise<Record<string, string>> {
  if (!existsSync('/bin/zsh')) return {}
  const dir = join(root, 'zsh')
  await mkdir(dir)
  await writeFile(join(dir, '.zshrc'), "PROMPT='%F{blue}%1~%f %# '\n")
  return { SHELL: '/bin/zsh', ZDOTDIR: dir }
}

/** macOS draws the window's buttons itself, outside the page, so screenshots would leave a gap. */
async function drawTrafficLights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const lights = document.createElement('div')
    // Where `trafficLightPosition` puts them, in the system's colours.
    lights.style.cssText = 'position:fixed;top:12.5px;left:14.5px;display:flex;gap:9px;z-index:2147483647;pointer-events:none'
    for (const [fill, edge] of [['#ff5f57', '#e0443e'], ['#febc2e', '#dea123'], ['#28c840', '#1aab29']]) {
      const light = document.createElement('span')
      light.style.cssText = `width:11px;height:11px;border-radius:50%;background:${fill};box-shadow:inset 0 0 0 0.5px ${edge}`
      lights.append(light)
    }
    document.body.append(lights)
  })
}

/** A Claude session in Auto mode, which edits and runs commands in the project without asking. */
async function startSession(page: Page): Promise<void> {
  await page.keyboard.press(`${modifier}+t`)
  await page.getByRole('button', { name: 'New Claude session' }).click()
  await expect(page.getByPlaceholder(/Message agent/)).toBeVisible()
  await chooseAuto(page, page.getByTitle('Permission mode (Shift+Tab)'))
}

async function chooseAuto(page: Page, picker: Locator): Promise<void> {
  await picker.click()
  await page.getByRole('menuitemradio', { name: 'Auto' }).click()
  await expect(picker).toHaveText('Auto')
  await expect(page.getByRole('menu')).toBeHidden()
}

async function openFile(page: Page, path: string): Promise<void> {
  const tree = page.getByRole('tree')
  const parts = path.split('/')
  for (const folder of parts.slice(0, -1)) {
    const item = tree.getByRole('treeitem', { name: folder, exact: true })
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
  await tree.getByRole('treeitem', { name: parts.at(-1), exact: true }).click()
}

async function runScript(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'package.json' }).click()
  await page.getByTitle(`Run ${name}`).click()
  await expect(page.getByRole('tab', { name: `npm run ${name}` })).toBeVisible()
}

/** Drags a tab to the right or bottom edge of the first tabset, splitting it in two. */
async function split(page: Page, tab: Locator, edge: 'right' | 'bottom'): Promise<void> {
  const from = (await tab.boundingBox())!
  const panels = (await page.locator('[data-tab-panels]').first().boundingBox())!
  await page.mouse.move(from.x + 20, from.y + 10)
  await page.mouse.down()
  await page.mouse.move(panels.x + panels.width / 2, panels.y + panels.height / 2, { steps: 10 })
  const to = edge === 'right'
    ? { x: panels.x + panels.width - 30, y: panels.y + panels.height / 2 }
    : { x: panels.x + panels.width / 2, y: panels.y + panels.height - 30 }
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

/** Waits for the element's transitions, such as a popover fading in, to finish. */
async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)))
}

async function sendAndWait(page: Page, text: string): Promise<void> {
  await send(page, text)
  const turn = script.turns[text]!
  const reply = turn.steps.findLast((step) => 'text' in step)!.text
  await expect(page.getByRole('log').last()).toContainText(reply.split('\n')[0]!.slice(0, 40))
}

test('overview', () =>
  onStage(async ({ page }) => {
    await openFile(page, 'package.json')
    await runScript(page, 'dev')
    await runScript(page, 'test:watch')

    await startSession(page)
    await sendAndWait(page, prompts.timeZones)
    await split(page, page.getByRole('tab', { name: /^The tide chart/ }), 'right')

    await page.getByRole('button', { name: /main.*files changed/ }).click()
    await page.getByRole('region', { name: 'Changes' }).getByRole('button', { name: /TideChart\.tsx/ }).click()
    await expect(page.getByRole('tab', { name: /TideChart\.tsx/ })).toBeVisible()

    await page.keyboard.press(`${modifier}+t`)
    await page.getByRole('button', { name: 'New terminal' }).click()
    const terminal = page.locator('.xterm-rows:visible')
    await expect(terminal).toContainText('tidepool %')
    await page.keyboard.type('git log --oneline --graph\n')
    await expect(terminal).toContainText('Parse Admiralty tide tables')
    await page.keyboard.type('git diff --stat\n')
    await expect(terminal).toContainText('2 files changed')
    await split(page, page.getByRole('tab', { name: 'Terminal' }), 'bottom')
    await page.getByRole('tab', { name: /TideChart\.tsx/ }).click()

    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, 'overview.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await settled(page.locator('body'))
    await page.screenshot({ path: join(output, 'overview-dark.png') })
  }))

test('claude and codex', () =>
  onStage(async ({ page }) => {
    await startSession(page)
    await sendAndWait(page, prompts.timeZones)

    await page.keyboard.press(`${modifier}+t`)
    await page.getByRole('button', { name: 'New Codex session' }).click()
    const picker = page.getByTitle('Permission mode (Shift+Tab)').filter({ visible: true })
    await chooseAuto(page, picker)
    await send(page, codexPrompt)
    await expect(page.getByRole('log').filter({ visible: true })).toContainText('It needs an API key')
    await split(page, page.getByRole('tab', { name: /^Why does/ }), 'right')

    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, 'claude-and-codex.png') })
  }))

test('processes', () =>
  onStage(async ({ page }) => {
    await openFile(page, 'package.json')
    await runScript(page, 'test:watch')
    await runScript(page, 'sync')
    await expect(page.getByText('Failed (exit code 1)')).toBeVisible()
    await runScript(page, 'dev')
    await expect(page.locator('.xterm-rows:visible')).toContainText('/api/tides?harbour=oban')
    // Shows the dev server's port once it's found.
    const processes = page.getByRole('region', { name: 'Processes' })
    await expect(processes.getByRole('button', { name: 'npm run dev' }).locator('..')).toContainText(/\d{4}/)

    await startSession(page)
    await sendAndWait(page, prompts.devServer)
    await split(page, page.getByRole('tab', { name: /^Does the forecast/ }), 'right')
    await page.getByRole('tab', { name: 'npm run dev' }).click()
    // The agent's activity, open to show it using the IDE's process tools.
    const log = page.getByRole('log')
    await log.getByRole('button', { name: /start_process/ }).first().click()
    await log.getByRole('button', { name: /read_output/ }).last().click()

    await page.mouse.move(0, 0)
    await page.screenshot({ path: join(output, 'processes.png') })
  }))

test('cold cache', () =>
  onStage(async ({ page }) => {
    await page.clock.install()
    await startSession(page)
    await sendAndWait(page, prompts.timeZones)
    await page.clock.fastForward(75 * 60_000)
    const cache = page.getByRole('button', { name: 'Prompt cache', exact: true })
    await expect(cache).toHaveText('Cold')
    await cache.hover()
    const popover = page.getByRole('dialog', { name: 'Prompt cache details' })
    await expect(popover.getByRole('button', { name: 'Continue in new session' })).toBeVisible()
    await settled(popover)
    const session = (await page.locator('[data-tab-panels]').first().boundingBox())!
    await page.screenshot({ path: join(output, 'cold-cache.png'), clip: session })
  }, { width: 1100, height: 760 }))

// The animation is a Lissajous trace on weekdays and orbiting dots at the weekend.
for (const [name, day] of [['lissajous', '2026-11-23T10:00'], ['orbit', '2026-11-28T10:00']] as const) {
  test(`working animation (${name})`, () =>
    onStage(async ({ app, page }) => {
      // Stepping a fake clock gives evenly spaced frames, however long each screenshot takes.
      await page.clock.install({ time: new Date(day) })
      await startSession(page)
      await send(page, prompts.forecast)
      const animation = page.getByRole('log').locator('canvas[aria-label="Working"]')
      await expect(animation).toBeVisible()
      await page.mouse.move(0, 0)
      // Zoomed by Electron, the canvas draws at the higher resolution rather than being scaled up.
      // Only once the session is showing: zoomed first, the narrow window would hide it.
      const zoom = 2
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom), zoom)
      await expect(page.getByRole('log').getByText('Thinking…')).toBeVisible()

      const row = animation.locator('xpath=../..')
      // The transcript settles at the bottom after zooming.
      await expect.poll(async () => JSON.stringify(await animation.boundingBox()), { intervals: [200] }).toBe(JSON.stringify(await animation.boundingBox()))
      const icon = (await animation.boundingBox())!
      const label = (await row.locator('span').last().boundingBox())!
      // Playwright's screenshots don't allow for Electron's zoom, so Electron takes them, in window pixels.
      const pad = 6
      const rect = {
        x: Math.round((icon.x - pad) * zoom),
        y: Math.round((label.y - pad) * zoom),
        width: Math.round((label.x + label.width - icon.x + 2 * pad) * zoom),
        height: Math.round((label.height + 2 * pad) * zoom),
      }
      const frames = await mkdtemp(join(tmpdir(), 'escritoire-frames-'))
      const fps = 25
      for (let frame = 0; frame < 4 * fps; frame++) {
        await page.clock.runFor(1000 / fps)
        const png = await app.evaluate(
          async ({ BrowserWindow }, rect) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(rect)).toPNG().toString('base64'),
          rect,
        )
        await writeFile(join(frames, `${String(frame).padStart(3, '0')}.png`), png, 'base64')
      }
      await mkdir(output, { recursive: true })
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-framerate', String(fps), '-i', join(frames, '%03d.png'),
        '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none',
        '-loop', '0', join(output, `working-${name}.gif`),
      ])
      await rm(frames, { recursive: true, force: true })
    }))
}

test('mobile', () =>
  onStage(async ({ page }) => {
    await startSession(page)
    await sendAndWait(page, prompts.timeZones)
    await openFile(page, 'package.json')
    await runScript(page, 'dev')

    const port = await turnOnRemoteAccess(page)
    const browser = await webkit.launch()
    try {
      const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' })
      const phone = await context.newPage()
      await pair(page, phone, port)
      await phone.getByRole('button', { name: /^The tide chart/ }).click()
      await expect(phone.getByRole('log')).toContainText('own time zone')
      await expect(phone.getByText('Opus 5.5')).toBeVisible()
      await phone.screenshot({ path: join(output, 'mobile.png') })
    } finally {
      await browser.close()
    }
  }))
