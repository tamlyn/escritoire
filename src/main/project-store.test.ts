import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from './project-store'

let root: string
let dataDir: string
let alpha: string
let beta: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'escritoire-test-')))
  dataDir = join(root, 'data')
  alpha = join(root, 'alpha')
  beta = join(root, 'beta')
  await mkdir(alpha)
  await mkdir(beta)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ProjectStore', () => {
  it('opens a directory as the active project', async () => {
    const store = await ProjectStore.load(dataDir)
    const state = await store.openProject(alpha)

    expect(state.projects).toEqual([expect.objectContaining({ path: alpha, name: 'alpha', isOpen: true })])
    expect(state.activeProjectId).toBe(state.projects[0]!.id)
  })

  it('reuses the existing project when the same path is opened again', async () => {
    const store = await ProjectStore.load(dataDir)
    const first = await store.openProject(alpha)
    await store.openProject(beta)
    const again = await store.openProject(`${alpha}/`)

    expect(again.projects).toHaveLength(2)
    expect(again.activeProjectId).toBe(first.activeProjectId)
  })

  it('rejects paths that are not directories', async () => {
    const file = join(root, 'file.txt')
    await writeFile(file, '')
    const store = await ProjectStore.load(dataDir)

    await expect(store.openProject(file)).rejects.toThrow('Not a directory')
    await expect(store.openProject(join(root, 'missing'))).rejects.toThrow()
  })

  it('activates the most recent open project when the active one is closed', async () => {
    const store = await ProjectStore.load(dataDir)
    const a = (await store.openProject(alpha)).activeProjectId!
    const b = (await store.openProject(beta)).activeProjectId!

    const state = await store.closeProject(b)

    expect(state.activeProjectId).toBe(a)
    expect(state.projects.find((p) => p.id === b)?.isOpen).toBe(false)
  })

  it('keeps a closed project’s layout but forgets a removed one’s', async () => {
    const store = await ProjectStore.load(dataDir)
    const id = (await store.openProject(alpha)).activeProjectId!
    await store.saveLayout(id, { version: 1 })

    await store.closeProject(id)
    expect(await store.loadLayout(id)).toEqual({ version: 1 })

    const state = await store.removeProject(id)
    expect(state.projects).toEqual([])
    expect(state.activeProjectId).toBeNull()
  })

  it('persists state across loads', async () => {
    const store = await ProjectStore.load(dataDir)
    const id = (await store.openProject(alpha)).activeProjectId!
    await store.saveLayout(id, { version: 1 })

    const reloaded = await ProjectStore.load(dataDir)

    expect(reloaded.getState().activeProjectId).toBe(id)
    expect(await reloaded.loadLayout(id)).toEqual({ version: 1 })
  })
})
