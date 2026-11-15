import type { Api, EventSubscriber } from '../../shared/api'

declare global {
  interface Window {
    flushEdits: () => Promise<void>
    api: Api
    subscribe: EventSubscriber
  }
}

const pending = new Set<Promise<unknown>>()
// A query can run for hours, and quitting closes its connection anyway.
const unflushed = new Set<string>(['runSql'])
export const flushers = new Set<() => Promise<void>>()
export const api = Object.fromEntries(Object.entries(window.api).map(([name, method]) => [name, (...args: unknown[]) => {
  const call = (method as (...args: unknown[]) => Promise<unknown>)(...args)
  if (unflushed.has(name)) return call
  pending.add(call)
  const cleanup = () => { pending.delete(call) }
  void call.then(cleanup, cleanup)
  return call
}])) as Api
window.flushEdits = async () => {
  document.body.inert = true
  try {
    await Promise.all([...flushers].map((flush) => flush()))
    while (pending.size) await Promise.all([...pending])
  } catch (error) {
    document.body.inert = false
    throw error
  }
}
export const subscribe = window.subscribe

/** IPC prefixes a remote error with the channel name, which means nothing to the user. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
