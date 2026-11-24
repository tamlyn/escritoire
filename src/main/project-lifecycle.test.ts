import { beforeEach, expect, it, vi } from 'vitest'
import type { AppState, Project } from '../shared/api'
import { ProjectLifecycle, type ProjectResource } from './project-lifecycle'

let calls: string[]
let projects: { getProject: (id: string) => Project; closeProject: (id: string) => Promise<AppState>; removeProject: (id: string) => Promise<AppState> }

const state: AppState = { projects: [], activeProjectId: null }

beforeEach(() => {
  calls = []
  projects = {
    getProject: (id) => {
      if (id !== 'p1') throw new Error(`No project ${id}`)
      return { id, path: '/p1', name: 'p1', isOpen: true, lastActiveAt: 0 }
    },
    closeProject: async (id) => { calls.push(`project close ${id}`); return state },
    removeProject: async (id) => { calls.push(`project remove ${id}`); return state },
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function resource(name: string, { remove = true, fail = false } = {}): ProjectResource {
  const act = (verb: string) => async (id: string) => {
    calls.push(`${name} ${verb} ${id}`)
    if (fail) throw new Error(`${name} failed`)
  }
  return remove ? { closeProject: act('close'), removeProject: act('remove') } : { closeProject: act('close') }
}

it('closes every resource, then the project, even when one fails', async () => {
  const lifecycle = new ProjectLifecycle(projects, [[resource('sessions', { fail: true })], [resource('terminals')]])

  await expect(lifecycle.close('p1')).resolves.toBe(state)

  expect(calls).toEqual(['sessions close p1', 'terminals close p1', 'project close p1'])
})

it('removes every resource, closing those that keep nothing, then the project', async () => {
  const lifecycle = new ProjectLifecycle(projects, [[resource('terminals'), resource('processes', { remove: false }), { removeProject: resource('connections').removeProject }]])

  await lifecycle.remove('p1')

  expect(calls).toEqual(['terminals remove p1', 'processes close p1', 'connections remove p1', 'project remove p1'])
})

it('removes the project even when a resource fails to be removed', async () => {
  const lifecycle = new ProjectLifecycle(projects, [[resource('sessions', { fail: true })], [resource('terminals')]])

  await expect(lifecycle.remove('p1')).resolves.toBe(state)

  expect(calls).toEqual(['sessions remove p1', 'terminals remove p1', 'project remove p1'])
})

it('finishes each stage before starting the next', async () => {
  let finishSessions!: () => void
  const sessions: ProjectResource = {
    removeProject: () => new Promise((resolve) => { finishSessions = () => { calls.push('sessions removed'); resolve() } }),
  }
  const lifecycle = new ProjectLifecycle(projects, [[sessions], [resource('processes')]])

  const removing = lifecycle.remove('p1')
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(calls).toEqual([])
  finishSessions()
  await removing

  expect(calls).toEqual(['sessions removed', 'processes remove p1', 'project remove p1'])
})

it('touches nothing for a project it does not know', async () => {
  const lifecycle = new ProjectLifecycle(projects, [[resource('terminals')]])

  await expect(lifecycle.remove('../projects')).rejects.toThrow('No project')
  expect(calls).toEqual([])
})
