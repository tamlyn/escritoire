import type { AsyncSubscription } from '@parcel/watcher'

/** A watch on each of whichever projects are wanted at the time. */
export class ProjectWatches {
  private readonly watches = new Map<string, Promise<AsyncSubscription | undefined>>()

  /** `subscribe` reports its own failures, resolving to `undefined`. */
  constructor(private readonly subscribe: (projectId: string) => Promise<AsyncSubscription | undefined>) {}

  /** Watches exactly these projects, starting and stopping watches as needed. */
  set(projectIds: string[]): void {
    for (const projectId of this.watches.keys()) if (!projectIds.includes(projectId)) void this.stop(projectId)
    for (const projectId of projectIds) {
      if (!this.watches.has(projectId)) this.watches.set(projectId, this.subscribe(projectId))
    }
  }

  async clear(): Promise<void> {
    await Promise.all([...this.watches.keys()].map((projectId) => this.stop(projectId)))
  }

  private async stop(projectId: string): Promise<void> {
    const watch = this.watches.get(projectId)
    this.watches.delete(projectId)
    await (await watch)?.unsubscribe()
  }
}
