/**
 * The asynchronous work a service has under way, so that closing it can refuse
 * new work, cancel what can be cancelled and wait for the rest to finish.
 * Failures belong to whoever started the work; closing only waits for it.
 */
export class Work {
  private readonly controller = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  get closed(): boolean {
    return this.controller.signal.aborted
  }

  /** Starts `task`, or refuses it once closing. Long tasks should stop when `signal` aborts. */
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Closed'))
    const promise = (async () => task(this.controller.signal))()
    this.pending.add(promise)
    const settle = () => { this.pending.delete(promise) }
    void promise.then(settle, settle)
    return promise
  }

  async close(): Promise<void> {
    this.controller.abort(new Error('Closed'))
    await Promise.allSettled([...this.pending])
  }
}
