import type { AsyncSubscription } from '@parcel/watcher'

/** A watch on each of whichever projects are wanted at the time. */
export class ProjectWatches {
  private readonly watches = new Map<string, Promise<AsyncSubscription | undefined>>()
  private readonly stopping = new Set<Promise<void>>()

  /** `subscribe` reports its own failures, resolving to `undefined`. */
  constructor(
    private readonly subscribe: (projectId: string) => Promise<AsyncSubscription | undefined>,
    private readonly onStop: (projectId: string) => void = () => {},
  ) {}

  /** Watches exactly these projects, starting and stopping watches as needed. */
  set(projectIds: string[]): void {
    for (const projectId of this.watches.keys()) if (!projectIds.includes(projectId)) this.stop(projectId)
    for (const projectId of projectIds) {
      if (!this.watches.has(projectId)) this.watches.set(projectId, this.subscribe(projectId))
    }
  }

  /** Stops every watch, and waits for those already stopping. */
  async clear(): Promise<void> {
    for (const projectId of this.watches.keys()) this.stop(projectId)
    await Promise.all([...this.stopping])
  }

  private stop(projectId: string): void {
    const watch = this.watches.get(projectId)
    this.watches.delete(projectId)
    this.onStop(projectId)
    const stopped = (async () => {
      try {
        await (await watch)?.unsubscribe()
      } catch (error) {
        console.error(`Couldn't stop watching ${projectId}:`, error)
      }
    })()
    this.stopping.add(stopped)
    void stopped.then(() => this.stopping.delete(stopped))
  }
}
