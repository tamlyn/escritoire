/** An async iterable fed by `push`, for streaming input into an agent. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | undefined
  private ended = false

  push(value: T): void {
    if (this.ended) return
    if (this.waiting) {
      this.waiting({ value, done: false })
      this.waiting = undefined
    } else {
      this.buffer.push(value)
    }
  }

  end(): void {
    this.ended = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = undefined
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift()!, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      },
    }
  }
}
