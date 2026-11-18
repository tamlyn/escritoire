import { api, isDesktop } from '../api'
import type { PendingSession } from '../ProjectWorkspace'

/** What the inbox offers this browser: to turn on notifications, or how to become able to. */
export type PushOffer = 'enable' | 'install' | null

export function pushOffer(): PushOffer {
  if (isDesktop) return null
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  // iOS only allows push for a web app added to the home screen.
  // iPadOS Safari says it's a Mac, but Macs have no touch screen.
  const iOS = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  if (iOS && !standalone) return 'install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null
  return Notification.permission === 'default' ? 'enable' : null
}

/** Must follow a tap, or browsers refuse to ask for permission. */
export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) === 'granted') await sendSubscription()
}

/** Browsers can rotate a subscription, so it's sent again each time the app loads. */
export function refreshPushSubscription(): void {
  if (isDesktop || !('serviceWorker' in navigator) || !('Notification' in window)) return
  if (Notification.permission === 'granted') sendSubscription().catch((error: unknown) => console.error(error))
}

async function sendSubscription(): Promise<void> {
  await navigator.serviceWorker.register('/sw.js')
  const { pushManager } = await navigator.serviceWorker.ready
  const key = decodeKey(await api.getPushKey())
  let subscription = await pushManager.getSubscription()
  // Made with a key main no longer has, as after its data was cleared, so nothing could be sent to it.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const { endpoint, keys } = subscription.toJSON()
  if (endpoint && keys?.p256dh && keys.auth) await api.setPushSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
}

function sameKey(existing: ArrayBuffer | null, key: Uint8Array): boolean {
  return existing !== null && new Uint8Array(existing).every((byte, index) => byte === key[index]) && existing.byteLength === key.length
}

function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

// Outside the views: tapping a notification wakes the phone, and reconnecting rebuilds them.
let tapped: PendingSession | null = isDesktop ? null : sessionInUrl()

export function notificationSessionShown(): void {
  tapped = null
}

/** Goes to the session of each notification tapped, including the one that opened the app. */
export function followNotifications(goToSession: (session: PendingSession) => void): () => void {
  if (isDesktop || !('serviceWorker' in navigator)) return () => {}
  if (tapped) goToSession(tapped)
  const onMessage = (event: MessageEvent<{ goToSession?: PendingSession }>) => {
    if (!event.data.goToSession) return
    tapped = event.data.goToSession
    goToSession(tapped)
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}

function sessionInUrl(): PendingSession | null {
  const query = new URLSearchParams(location.search)
  const projectId = query.get('project')
  const agent = query.get('agent')
  const agentSessionId = query.get('session')
  if (!projectId || !agentSessionId || (agent !== 'claude' && agent !== 'codex')) return null
  // Once only, so reloading doesn't go back to it.
  history.replaceState(null, '', '/')
  return { projectId, pointer: { agent, agentSessionId }, title: query.get('title') ?? '' }
}
