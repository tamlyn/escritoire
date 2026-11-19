import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AppState, Project } from '../shared/api'
import { deleteJson, readJson, writeJson } from './json-file'
import { expandHome } from './paths'

export class ProjectStore {
  /** `activeProjectId` is the open project most recently active in any client, where a new client starts. */
  private state: AppState = { projects: [], activeProjectId: null }

  private constructor(private readonly dataDir: string) {}

  static async load(dataDir: string): Promise<ProjectStore> {
    const store = new ProjectStore(dataDir)
    const saved = (await readJson(store.statePath)) as AppState | undefined
    if (saved) store.state = saved
    // Open means it has been used since launch, so only the one to resume in starts open.
    for (const project of store.state.projects) project.isOpen = project.id === store.state.activeProjectId
    return store
  }

  getState(): AppState {
    return structuredClone(this.state)
  }

  getProject(id: string): Project {
    return structuredClone(this.find(id))
  }

  async openProject(inputPath: string): Promise<AppState> {
    const path = await realpath(expandHome(inputPath.trim()))
    if (!(await stat(path)).isDirectory()) throw new Error(`Not a directory: ${path}`)

    let project = this.state.projects.find((p) => p.path === path)
    if (!project) {
      project = { id: randomUUID(), path, name: basename(path), isOpen: true, lastActiveAt: 0 }
      this.state.projects.push(project)
    }
    return this.activateProject(project.id)
  }

  async activateProject(id: string): Promise<AppState> {
    const project = this.find(id)
    project.isOpen = true
    project.lastActiveAt = Date.now()
    this.state.activeProjectId = id
    return this.save()
  }

  async closeProject(id: string): Promise<AppState> {
    this.find(id).isOpen = false
    if (this.state.activeProjectId === id) this.activateMostRecentOpen()
    return this.save()
  }

  async removeProject(id: string): Promise<AppState> {
    this.find(id)
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    if (this.state.activeProjectId === id) this.activateMostRecentOpen()
    await deleteJson(this.layoutPath(id))
    return this.save()
  }

  async loadLayout(projectId: string): Promise<unknown> {
    return readJson(this.layoutPath(this.find(projectId).id))
  }

  async saveLayout(projectId: string, layout: unknown): Promise<void> {
    await writeJson(this.layoutPath(this.find(projectId).id), layout)
  }

  /** The agent session ids of the project's open tabs. */
  async sessionTabs(projectId: string): Promise<Set<string>> {
    const ids = new Set<string>()
    // The layout's shape belongs to the renderer's workspace library, so only the tab data is assumed.
    const visit = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return
      const { kind, agentSessionId } = value as Record<string, unknown>
      if (kind === 'session' && typeof agentSessionId === 'string') ids.add(agentSessionId)
      Object.values(value).forEach(visit)
    }
    visit(await this.loadLayout(projectId))
    return ids
  }

  private get statePath(): string {
    return join(this.dataDir, 'projects.json')
  }

  private layoutPath(projectId: string): string {
    return join(this.dataDir, 'layouts', `${projectId}.json`)
  }

  private find(id: string): Project {
    const project = this.state.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Unknown project: ${id}`)
    return project
  }

  private activateMostRecentOpen(): void {
    const next = this.state.projects
      .filter((p) => p.isOpen)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
    if (next) next.lastActiveAt = Date.now()
    this.state.activeProjectId = next?.id ?? null
  }

  /** The state as this change left it, which a concurrent change may have moved on from by the time it's saved. */
  private async save(): Promise<AppState> {
    const state = this.getState()
    await writeJson(this.statePath, this.state)
    return state
  }
}
