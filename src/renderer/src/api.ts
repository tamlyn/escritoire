import { useSyncExternalStore } from 'react'
import type { Api } from '../../shared/api'
import { type ApiConnection, connectApi, notAuthorized } from '../../shared/api-client'

declare global {
  interface Window {
    flushEdits: () => Promise<void>
    /** Only in the desktop window. */
    desktop?: { apiConnection(): Promise<ApiConnection> }
  }
}

/** The desktop window rather than a browser on another device. */
export const isDesktop = window.desktop !== undefined

const tokenKey = 'escritoire.token'

/** A browser's token from pairing, if it has paired. */
export function pairedToken(): string | null {
  try {
    return localStorage.getItem(tokenKey)
  } catch {
    return null
  }
}

export function rememberToken(token: string): void {
  localStorage.setItem(tokenKey, token)
}

function connection(): Promise<ApiConnection> {
  if (window.desktop) return window.desktop.apiConnection()
  const token = pairedToken()
  // Unpaired, the pairing screen shows instead, and reloads once paired.
  if (!token) return new Promise(() => {})
  return Promise.resolve({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api`, token })
}

let lost: Error | null = null
const lostListeners = new Set<() => void>()

const client = connectApi(connection(), {
  onLost: (error) => {
    if (!isDesktop && error.message === notAuthorized) {
      // Revoked: pair again.
      try { localStorage.removeItem(tokenKey) } catch { /* Nothing to forget. */ }
      location.reload()
      return
    }
    lost = error
    for (const listener of lostListeners) listener()
  },
})

/** Why the connection to main was lost, once it has been. */
export function useConnectionLost(): Error | null {
  return useSyncExternalStore(
    (listener) => {
      lostListeners.add(listener)
      return () => lostListeners.delete(listener)
    },
    () => lost,
  )
}

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
