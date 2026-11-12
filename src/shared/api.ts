export type Project = {
  id: string
  path: string
  name: string
  isOpen: boolean
  lastActiveAt: number
}

export type AppState = {
  projects: Project[]
  activeProjectId: string | null
}

/**
 * Everything the renderer can ask of the main process. Each method is one
 * `ipcRenderer.invoke` channel of the same name.
 */
export type Api = {
  getState(): Promise<AppState>
  /** Adds the directory as a project if it isn't one already, then activates it. */
  openProject(path: string): Promise<AppState>
  activateProject(id: string): Promise<AppState>
  /** Releases the project's runtime but keeps its layout for reopening. */
  closeProject(id: string): Promise<AppState>
  /** Closes the project and forgets its layout. */
  removeProject(id: string): Promise<AppState>
  loadLayout(projectId: string): Promise<unknown>
  saveLayout(projectId: string, layout: unknown): Promise<void>
  /** Directories matching a partially typed path, for completion in the project switcher. */
  completeDirectory(partialPath: string): Promise<string[]>
}

// A record rather than an array so the compiler rejects a missing or misspelt method.
const apiMethodSet: Record<keyof Api, true> = {
  getState: true,
  openProject: true,
  activateProject: true,
  closeProject: true,
  removeProject: true,
  loadLayout: true,
  saveLayout: true,
  completeDirectory: true,
}

export const apiMethods = Object.keys(apiMethodSet) as (keyof Api)[]
