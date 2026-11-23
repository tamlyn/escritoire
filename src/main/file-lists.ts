/**
 * Each watched project's file list, kept until something in the project or its
 * git directory changes, since find in files lists the project on every
 * keystroke. An unwatched project would never say it changed, so it lists afresh.
 */
export class FileLists {
  private watched = new Set<string>()
  private readonly lists = new Map<string, Promise<string[]>>()

  constructor(private readonly load: (projectId: string) => Promise<string[]>) {}

  get(projectId: string): Promise<string[]> {
    if (!this.watched.has(projectId)) return this.load(projectId)
    let list = this.lists.get(projectId)
    if (!list) {
      const loading = this.load(projectId)
      loading.catch(() => { if (this.lists.get(projectId) === loading) this.lists.delete(projectId) })
      this.lists.set(projectId, loading)
      list = loading
    }
    return list
  }

  /** A list loading meanwhile may already be out of date, so it isn't kept either. */
  changed(projectId: string): void {
    this.lists.delete(projectId)
  }

  watch(projectIds: string[]): void {
    this.watched = new Set(projectIds)
    for (const projectId of this.lists.keys()) if (!this.watched.has(projectId)) this.lists.delete(projectId)
  }
}
