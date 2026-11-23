/// <reference types="electron-vite/node" />
import { Worker } from 'node:worker_threads'
import type { SearchResults, TextQuery } from '../shared/search'
import workerPath from './project-search-worker?modulePath'

type Search = { root: string; paths: readonly string[]; query: TextQuery }

export type SearchRequest = ({ type: 'search'; id: number } & Search) | { type: 'cancel'; id: number }

export type SearchWorkerMessage =
  | { type: 'results'; id: number; results: SearchResults | null }
  | { type: 'failed'; id: number; message: string }
  | { type: 'alive' }

type Running = {
  /** The worker's id for it, new each time it's sent. */
  id: number
  search: Search
  /** Gone once abandoned here, though the worker may still be running it. */
  caller: { resolve: (results: SearchResults | null) => void; reject: (error: Error) => void } | null
}

const stuck = 'The search took too long, so it was stopped. A regular expression that backtracks a lot can do that.'

/**
 * Runs find in files in a worker thread, which keeps file contents between
 * searches. A worker that says nothing for `stuckMs` while searching is in a
 * regular expression that backtracks, and is stopped.
 */
export class ProjectSearchRunner {
  private worker: Worker | undefined
  private nextId = 0
  private readonly running = new Map<number, Running>()
  private watchdog: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: { path: string; stuckMs: number } = { path: workerPath, stuckMs: 5000 }) {}

  /** `null` once `signal` aborts. */
  search(root: string, paths: readonly string[], query: TextQuery, signal: AbortSignal): Promise<SearchResults | null> {
    return new Promise((resolve, reject) => {
      const running: Running = { id: 0, search: { root, paths, query }, caller: { resolve, reject } }
      this.send(running)
      signal.addEventListener('abort', () => this.abandon(running), { once: true })
    })
  }

  close(): void {
    this.stop()
    for (const { caller } of this.running.values()) caller?.reject(new Error('Search closed.'))
    this.running.clear()
  }

  private send(running: Running): void {
    running.id = ++this.nextId
    this.running.set(running.id, running)
    this.start().postMessage({ type: 'search', id: running.id, ...running.search } satisfies SearchRequest)
    this.watch()
  }

  private abandon(running: Running): void {
    if (!running.caller) return
    running.caller.resolve(null)
    running.caller = null
    if (this.running.get(running.id) === running) this.worker?.postMessage({ type: 'cancel', id: running.id } satisfies SearchRequest)
  }

  private start(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.options.path)
    worker.unref()
    worker.on('message', (message: SearchWorkerMessage) => {
      clearTimeout(this.watchdog)
      this.watchdog = undefined
      if (message.type !== 'alive') {
        const caller = this.running.get(message.id)?.caller
        this.running.delete(message.id)
        if (message.type === 'results') caller?.resolve(message.results)
        else caller?.reject(new Error(message.message))
      }
      this.watch()
    })
    worker.on('error', (error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))))
    worker.on('exit', () => { if (this.worker === worker) this.fail(new Error('Search stopped unexpectedly.')) })
    this.worker = worker
    return worker
  }

  private watch(): void {
    if (this.running.size === 0 || this.watchdog) return
    this.watchdog = setTimeout(() => this.unstick(), this.options.stuckMs)
  }

  /**
   * A search abandoned for a newer one is the likelier culprit, so with one
   * running the newer searches start again in a new worker; otherwise they fail.
   */
  private unstick(): void {
    const running = [...this.running.values()]
    this.stop()
    this.running.clear()
    const retry = running.some(({ caller }) => !caller)
    for (const search of running) {
      if (!search.caller) continue
      if (retry) this.send(search)
      else search.caller.reject(new Error(stuck))
    }
  }

  private fail(error: Error): void {
    this.stop()
    for (const { caller } of this.running.values()) caller?.reject(error)
    this.running.clear()
  }

  private stop(): void {
    const worker = this.worker
    this.worker = undefined
    clearTimeout(this.watchdog)
    this.watchdog = undefined
    void worker?.terminate()
  }
}
