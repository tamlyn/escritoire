import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { fakeCodex, openProject, send, startCodexSession } from './agent'
import { launchApp, type RunningApp } from './app'

type Context = RunningApp & { agent: ReturnType<typeof fakeCodex> }

async function withSession(run: (context: Context) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  await mkdir(project)
  const agent = fakeCodex(join(root, 'codex'))
  const app = await launchApp(join(root, 'data'), agent.env)
  await openProject(app.page, project)
  await startCodexSession(app.page)
  await run({ ...app, agent })
  await app.close()
  await rm(root, { recursive: true, force: true })
}

const working = (page: Page) => page.getByText('Working…')
const queued = (page: Page, text: string) => page.getByTitle('Queued until the turn ends').filter({ hasText: text })

test('shows a turn from the message to the reply', () =>
  withSession(async ({ page }) => {
    await send(page, 'hello there')
    await expect(page.getByText('Reply to: hello there')).toBeVisible()
    await expect(working(page)).toBeHidden()
    await expect(page.getByRole('tab', { name: 'hello there' })).toBeVisible()
  }))

test('shows a compact cache countdown with request and expiry times in a popover', () =>
  withSession(async ({ page }) => {
    await page.clock.install()
    await send(page, 'cache-hit')
    const cache = page.getByRole('button', { name: 'Prompt cache', exact: true })
    await expect(cache).toHaveText('30m?')
    await expect(cache).not.toHaveAttribute('title')
    await cache.hover()
    const popover = page.getByRole('dialog', { name: 'Prompt cache details' })
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('20,000')
    await expect(popover).toContainText('1,000')
    await expect(popover).toContainText('Assumes a 30-minute lifetime')
    await expect(popover).toContainText('Last request')
    await expect(popover).toContainText('Estimated expiry')
    const requestAt = await popover.locator('time').nth(0).getAttribute('datetime')
    const expiresAt = await popover.locator('time').nth(1).getAttribute('datetime')
    expect(Date.parse(expiresAt!) - Date.parse(requestAt!)).toBe(30 * 60_000)
    // Moving into the popover keeps its button reachable.
    await popover.getByRole('button', { name: 'Keep warm' }).hover()
    await page.clock.runFor(300)
    await expect(popover).toBeVisible()

    await send(page, 'cache-miss')
    await expect(cache).toHaveText('30m?')

    await page.clock.fastForward(2 * 60_000)
    await expect(cache).toHaveText('28m?')
    await page.clock.fastForward(29 * 60_000)
    await expect(cache).toHaveText('Cold?')
    await cache.hover()
    await expect(popover).toBeVisible()
    await expect(popover.getByRole('button', { name: 'Keep warm' })).toBeHidden()

    await send(page, 'hold')
    await expect(cache).toHaveText('Warm')
    await cache.hover()
    await expect(popover.getByRole('button', { name: 'Keep warm' })).toBeDisabled()
    await cache.press('Escape')
    await expect(popover).toBeHidden()
    await page.getByTitle('Interrupt').click()
  }))

test('moves straight between the context and cache popovers on hover', () =>
  withSession(async ({ page }) => {
    await send(page, 'cache-hit')
    await expect(working(page)).toBeHidden()
    const composer = page.getByPlaceholder(/Message agent/)
    await composer.focus()
    const contextButton = page.getByRole('button', { name: 'Context and plan usage' })
    const cacheButton = page.getByRole('button', { name: 'Prompt cache', exact: true })
    const context = page.getByRole('dialog').filter({ hasText: 'Context window' })
    const cache = page.getByRole('dialog', { name: 'Prompt cache details' })

    await contextButton.hover()
    await expect(context).toBeVisible()
    await cacheButton.hover()
    await expect(context).toBeHidden()
    await page.waitForTimeout(600)
    await expect(cache).toBeVisible()

    await contextButton.hover()
    await expect(cache).toBeHidden()
    await page.waitForTimeout(600)
    await expect(context).toBeVisible()
    // Hovering never takes focus from the composer.
    await expect(composer).toBeFocused()
  }))

test('keeps the cache warm on request without clearing the composer draft', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'cache-hit')
    await expect(working(page)).toBeHidden()
    const composer = page.getByPlaceholder(/Message agent/)
    await composer.fill('My next question')
    const cache = page.getByRole('button', { name: 'Prompt cache', exact: true })
    await cache.hover()
    const popover = page.getByRole('dialog', { name: 'Prompt cache details' })
    const requestAt = await popover.locator('time').first().getAttribute('datetime')
    await popover.getByRole('button', { name: 'Keep warm' }).click()

    await expect.poll(() => agent.messages().length).toBe(2)
    expect(agent.messages()[1]).toBe('Rewarm the prompt cache. Reply only with "Ready". Do not use tools or take any other action.')
    await expect(working(page)).toBeHidden()
    await expect(cache).toHaveText('30m?')
    await expect(composer).toHaveValue('My next question')
    await cache.hover()
    await expect(popover.locator('time').first()).not.toHaveAttribute('datetime', requestAt!)
  }))

test('keeps a chunk that fails to load to its own tab', () =>
  withSession(async ({ app, page }) => {
    await app.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['file:///*/highlighted-body-*'] }, (_details, callback) => {
        callback({ cancel: true })
      })
    })
    await send(page, 'code\n\n```js\nconst answer = 42\n```')
    await expect(page.getByRole('alert')).toContainText('This tab stopped working.')
    await expect(page.getByRole('button', { name: 'Reload window' })).toBeVisible()
    await expect(page.getByRole('banner')).toBeVisible()
  }))

test('sends the answer to a permission request back to the agent', () =>
  withSession(async ({ page }) => {
    await send(page, 'permission')
    await expect(page.getByText('Delete the build directory?')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'permission' }).getByLabel('Waiting for input')).toBeVisible()
    await page.getByRole('button', { name: 'Allow once' }).click()
    await expect(page.getByText('Decision: accept')).toBeVisible()
    await expect(page.getByText('Delete the build directory?')).toBeHidden()

    await send(page, 'permission again')
    await page.getByRole('button', { name: 'Deny' }).click()
    await expect(page.getByText('Decision: decline')).toBeVisible()
  }))

test('sends the answer to a question back to the agent', () =>
  withSession(async ({ page }) => {
    await send(page, 'question')
    await expect(page.getByText('Which colour?')).toBeVisible()
    await page.getByText('Blue', { exact: true }).click()
    await page.getByRole('button', { name: 'Answer' }).click()
    await expect(page.getByText('Answer: Blue')).toBeVisible()
    await expect(page.getByText('Which colour?')).toBeHidden()
  }))

test('sends queued messages in order once the turn ends, as edited', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'hold')
    await expect(working(page)).toBeVisible()
    await send(page, 'first')
    await send(page, 'unwanted')
    await send(page, 'last')
    await expect(page.getByTitle('Queued until the turn ends')).toHaveCount(3)

    await queued(page, 'unwanted').locator('..').getByTitle('Cancel').click()
    await expect(queued(page, 'unwanted')).toHaveCount(0)
    await queued(page, 'first').locator('..').getByTitle('Edit').click()
    await page.locator('.border-dashed textarea').fill('first, edited')
    await page.locator('.border-dashed textarea').press('Enter')
    await expect(queued(page, 'first, edited')).toBeVisible()

    agent.release()
    await expect(page.getByText('Reply to: last')).toBeVisible()
    expect(agent.messages()).toEqual(['hold', 'first, edited', 'last'])
  }))

test('holds a queued message while it is being edited, even if the turn ends', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'hold')
    await expect(working(page)).toBeVisible()
    await send(page, 'draft')
    await queued(page, 'draft').locator('..').getByTitle('Edit').click()
    const editor = page.locator('.border-dashed textarea')
    await editor.fill('draft, rewritten')

    agent.release()
    await expect(page.getByText('Reply to: hold')).toBeVisible()
    await expect(working(page)).toBeHidden()
    expect(agent.messages()).toEqual(['hold'])

    await editor.press('Enter')
    await expect(page.getByText('Reply to: draft, rewritten')).toBeVisible()
    expect(agent.messages()).toEqual(['hold', 'draft, rewritten'])
  }))

test('stops a turn, then sends what was queued straight away', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'hold')
    await page.getByTitle('Interrupt').click()
    await expect(working(page)).toBeHidden()

    await send(page, 'hold on')
    await expect(working(page)).toBeVisible()
    await send(page, 'a correction')
    await expect(queued(page, 'a correction')).toBeVisible()
    await page.getByTitle('Interrupt').click()
    await expect(page.getByText('Reply to: a correction')).toBeVisible()
    expect(agent.messages()).toEqual(['hold', 'hold on', 'a correction'])
  }))

test('stops a turn with Esc', () =>
  withSession(async ({ page }) => {
    await send(page, 'hold')
    await expect(working(page)).toBeVisible()
    await page.getByPlaceholder(/Queue a message/).press('Escape')
    await expect(working(page)).toBeHidden()
  }))

test('brings back sent prompts with the up arrow, without replacing a draft', () =>
  withSession(async ({ page }) => {
    await send(page, 'first prompt')
    await expect(page.getByText('Reply to: first prompt')).toBeVisible()
    await send(page, 'second prompt')
    await expect(page.getByText('Reply to: second prompt')).toBeVisible()
    const composer = page.getByPlaceholder(/Message agent/)

    await composer.press('ArrowUp')
    await expect(composer).toHaveValue('second prompt')
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue('first prompt')
    await composer.press('ArrowDown')
    await composer.press('ArrowDown')
    await expect(composer).toHaveValue('')

    await composer.fill('a draft')
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue('a draft')
  }))

test('edits a past message in a branch of the session, keeping the original', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'first')
    await expect(page.getByText('Reply to: first')).toBeVisible()
    await send(page, 'secnod')
    await expect(page.getByText('Reply to: secnod')).toBeVisible()
    await send(page, 'third')
    await expect(page.getByText('Reply to: third')).toBeVisible()

    const message = page.locator('.is-user').filter({ hasText: 'secnod' })
    await message.hover()
    await message.locator('..').getByTitle('Edit').click()
    await page.locator('.is-user textarea').fill('second')
    await page.locator('.is-user textarea').press('Enter')

    await expect(page.getByText('Reply to: second')).toBeVisible()
    await expect(page.getByText('Reply to: first')).toBeVisible()
    await expect(page.getByText('secnod')).toBeHidden()
    await expect(page.getByText('third')).toBeHidden()
    const [original, , , edited] = agent.turnStarts()
    expect(edited!.threadId).not.toBe(original!.threadId)
    expect(agent.messages()).toEqual(['first', 'secnod', 'third', 'second'])
  }))

test('says why a turn failed, and carries on in the same conversation', () =>
  withSession(async ({ page, agent }) => {
    await send(page, 'fail')
    await expect(page.getByText('The agent stopped: The model is unavailable')).toBeVisible()

    await send(page, 'try again')
    await expect(page.getByText('Reply to: try again')).toBeVisible()
    await expect(page.getByText('The agent stopped')).toBeHidden()
    const [failed, retried] = agent.turnStarts()
    expect(retried!.threadId).toBe(failed!.threadId)
  }))

test('remembers the model and effort chosen for future sessions, unless Shift was held', () =>
  withSession(async ({ page, agent }) => {
    const model = page.getByTitle('Model', { exact: true }).filter({ visible: true })
    await expect(model).toHaveText('Fake model· Medium')
    await send(page, 'first')
    await expect(page.getByText('Reply to: first')).toBeVisible()

    await model.click()
    const effort = page.getByRole('menuitem', { name: /Effort/ })
    await expect(effort).toContainText('Effort (Medium)')
    await effort.focus()
    await page.keyboard.press('ArrowRight')
    await expect(effort).toContainText('Effort (High)')
    await page.getByRole('radio', { name: 'Low' }).click({ modifiers: ['Shift'] })
    await expect(effort).toContainText('Effort (Low)')
    await page.getByRole('menuitemradio', { name: 'Other model' }).click({ modifiers: ['Shift'] })
    await expect(model).toHaveText('Other model')
    await send(page, 'second')
    await expect(page.getByText('Reply to: second')).toBeVisible()

    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+t`)
    await page.getByRole('button', { name: 'New Codex session' }).click()
    await expect(model).toHaveText('Fake model· High')
    await send(page, 'third')
    await expect(page.getByText('Reply to: third')).toBeVisible()

    expect(agent.turnStarts().map((turn) => turn.effort)).toEqual(['medium', null, 'high'])
  }))

test('restores a conversation after a restart, resuming the agent only when sent a message', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  const dataDir = join(root, 'data')
  await mkdir(project)
  const agent = fakeCodex(join(root, 'codex'))

  let { page, close } = await launchApp(dataDir, agent.env)
  await openProject(page, project)
  const composer = await startCodexSession(page)
  await page.getByTitle('Permission mode (Shift+Tab)').click()
  await page.getByRole('menuitemradio', { name: 'Full access' }).click()
  await page.getByTitle('Model', { exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Other model' }).click()
  await send(page, 'remember this')
  await expect(page.getByText('Reply to: remember this')).toBeVisible()
  await expect(working(page)).toBeHidden()
  await expect(page.getByTitle('Permission mode (Shift+Tab)')).toHaveText('Full access')
  await expect(page.getByTitle('Model', { exact: true })).toHaveText('Other model')
  await composer.fill('an unsent draft')

  await close()
  ;({ page, close } = await launchApp(dataDir, agent.env))
  await expect(page.getByText('Reply to: remember this')).toBeVisible()
  await expect(page.getByPlaceholder(/Message agent/)).toHaveValue('an unsent draft')
  await expect(page.getByTitle('Permission mode (Shift+Tab)')).toHaveText('Full access')
  expect(agent.messages()).toEqual(['remember this'])

  await send(page, 'and now this')
  await expect(page.getByText('Reply to: and now this')).toBeVisible()
  const [before, after] = agent.turnStarts()
  expect(after!.threadId).toBe(before!.threadId)
  for (const turn of [before, after]) {
    expect(turn).toMatchObject({ approvalPolicy: 'never', model: 'other-model', effort: null })
  }
  await expect(page.getByTitle('Permission mode (Shift+Tab)')).toHaveText('Full access')
  await expect(page.getByTitle('Model', { exact: true })).toHaveText('Other model')

  await close()
  await rm(root, { recursive: true, force: true })
})
