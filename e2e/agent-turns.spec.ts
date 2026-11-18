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

test('restores a conversation after a restart, resuming the agent only when sent a message', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-e2e-')))
  const project = join(root, 'project')
  const dataDir = join(root, 'data')
  await mkdir(project)
  const agent = fakeCodex(join(root, 'codex'))

  let { page, close } = await launchApp(dataDir, agent.env)
  await openProject(page, project)
  const composer = await startCodexSession(page)
  await send(page, 'remember this')
  await expect(page.getByText('Reply to: remember this')).toBeVisible()
  await expect(working(page)).toBeHidden()
  await page.getByTitle('Permission mode (Shift+Tab)').click()
  await page.getByRole('menuitemradio', { name: 'Full access' }).click()
  await expect(page.getByTitle('Permission mode (Shift+Tab)')).toHaveText('Full access')
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
  expect(after!.approvalPolicy).toBe('never')

  await close()
  await rm(root, { recursive: true, force: true })
})
