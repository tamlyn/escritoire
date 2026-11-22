import type { AppState } from '../shared/api'
import type { ProjectStore } from './project-store'

/** Something main keeps for each project, such as its sessions, shells or saved connections. */
export type ProjectResource = {
  /** Stops what runs for the project and saves what it keeps, for when it opens again. */
  closeProject?(projectId: string): Promise<void>
  /** Stops what runs and deletes what it keeps. Closing it is enough for a resource that keeps nothing. */
  removeProject?(projectId: string): Promise<void>
}

/** Closes and removes a project across everything main keeps for it. */
export class ProjectLifecycle {
  constructor(
    private readonly projects: Pick<ProjectStore, 'closeProject' | 'removeProject'>,
    private readonly resources: ProjectResource[],
  ) {}

  async close(projectId: string): Promise<AppState> {
    await this.each((resource) => resource.closeProject?.(projectId))
    return this.projects.closeProject(projectId)
  }

  /**
   * Removed even if a resource fails: a half-removed project can't safely open
   * again (its sessions are no longer saved), and project ids are never reused,
   * so what's left behind is only unused files.
   */
  async remove(projectId: string): Promise<AppState> {
    await this.each((resource) => (resource.removeProject ?? resource.closeProject)?.call(resource, projectId))
    return this.projects.removeProject(projectId)
  }

  /** Failing to save or delete one resource mustn't stop the others, or the project closing. */
  private async each(action: (resource: ProjectResource) => Promise<void> | undefined): Promise<void> {
    const results = await Promise.allSettled(this.resources.map(async (resource) => action(resource)))
    for (const result of results) if (result.status === 'rejected') console.error(result.reason)
  }
}
