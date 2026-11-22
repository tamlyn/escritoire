import { beforeEach, expect, it, vi } from 'vitest'
import type { AppState } from '../shared/api'
import { ProjectLifecycle, type ProjectResource } from './project-lifecycle'

let calls: string[]
let projects: { closeProject: (id: string) => Promise<AppState>; removeProject: (id: string) => Promise<AppState> }

const state: AppState = { projects: [], activeProjectId: null }

beforeEach(() => {
  calls = []
  projects = {
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
  const lifecycle = new ProjectLifecycle(projects, [resource('sessions', { fail: true }), resource('terminals')])

  await expect(lifecycle.close('p1')).resolves.toBe(state)

  expect(calls).toEqual(['sessions close p1', 'terminals close p1', 'project close p1'])
})

it('removes every resource, closing those that keep nothing, then the project', async () => {
  const lifecycle = new ProjectLifecycle(projects, [resource('terminals'), resource('processes', { remove: false }), { removeProject: resource('connections').removeProject }])

  await lifecycle.remove('p1')

  expect(calls).toEqual(['terminals remove p1', 'processes close p1', 'connections remove p1', 'project remove p1'])
})

it('removes the project even when a resource fails to be removed', async () => {
  const lifecycle = new ProjectLifecycle(projects, [resource('sessions', { fail: true }), resource('terminals')])

  await expect(lifecycle.remove('p1')).resolves.toBe(state)

  expect(calls).toEqual(['sessions remove p1', 'terminals remove p1', 'project remove p1'])
})
