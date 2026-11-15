import type { Api } from '../../shared/api'
import { type ApiConnection, connectApi } from '../../shared/api-client'

declare global {
  interface Window {
    flushEdits: () => Promise<void>
    desktop: { apiConnection(): Promise<ApiConnection> }
  }
}

const client = connectApi(window.desktop.apiConnection())

const pending = new Set<Promise<unknown>>()
// A query can run for hours, and quitting closes its connection anyway.
const unflushed = new Set<string>(['runSql'])
export const flushers = new Set<() => Promise<void>>()
export const api = Object.fromEntries(Object.entries(client.api).map(([name, method]) => [name, (...args: unknown[]) => {
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
export const subscribe = client.subscribe

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
