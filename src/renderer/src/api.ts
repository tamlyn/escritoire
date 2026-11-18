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

const activeProjectKey = 'escritoire.activeProject'

function storedActiveProject(): string | null {
  if (isDesktop) return null
  try {
    return localStorage.getItem(activeProjectKey)
  } catch {
    return null
  }
}

let activeProjectId = storedActiveProject()

/** Where to return after reconnecting, or after a browser reloads the page. */
export function rememberActiveProject(id: string | null): void {
  activeProjectId = id
  if (isDesktop) return
  try {
    if (id === null) localStorage.removeItem(activeProjectKey)
    else localStorage.setItem(activeProjectKey, id)
  } catch { /* It only misses returning to this project after a reload. */ }
}

export type ConnectionState = {
  reconnecting: boolean
  /** Edits that couldn't be saved on reconnecting, which reloading the views would discard. */
  unsavedError: string | null
  /** Goes up each time the views should be rebuilt from fresh snapshots. */
  epoch: number
}

let connectionState: ConnectionState = { reconnecting: false, unsavedError: null, epoch: 0 }
const connectionListeners = new Set<() => void>()
const reloadListeners = new Set<() => void>()

function setConnectionState(next: Partial<ConnectionState>): void {
  connectionState = { ...connectionState, ...next }
  for (const listener of connectionListeners) listener()
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    (listener) => {
      connectionListeners.add(listener)
      return () => connectionListeners.delete(listener)
    },
    () => connectionState,
  )
}

/** For stores that outlive the views, to fetch their lists again. */
export function onViewsReloaded(listener: () => void): void {
  reloadListeners.add(listener)
}

export function reloadViews(): void {
  for (const listener of reloadListeners) listener()
  setConnectionState({ unsavedError: null, epoch: connectionState.epoch + 1 })
}

async function recover(): Promise<void> {
  const flushed = await Promise.allSettled([...flushers].map((flush) => flush()))
  // Lost again: the next reconnection recovers.
  if (connectionState.reconnecting) return
  const failed = flushed.find((result) => result.status === 'rejected')
  if (failed) setConnectionState({ unsavedError: errorMessage(failed.reason) })
  else reloadViews()
}

const client = connectApi(connection(), {
  activeProjectId: () => activeProjectId,
  onLost: (error) => {
    if (!isDesktop && error.message === notAuthorized) {
      // Revoked: pair again.
      try { localStorage.removeItem(tokenKey) } catch { /* Nothing to forget. */ }
      location.reload()
      return
    }
    setConnectionState({ reconnecting: true })
  },
  onReconnected: () => {
    setConnectionState({ reconnecting: false })
    void recover()
  },
})

// The desktop's socket is on the loopback interface, so it can't die unnoticed.
if (!isDesktop) {
  window.addEventListener('online', client.checkConnection)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client.checkConnection()
  })
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
