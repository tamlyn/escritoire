import type { SessionTarget } from './agent'

/** A browser paired to use Escritoire remotely. Its token is known only to it. */
export type PairedDevice = {
  id: string
  name: string
  pairedAt: number
  /** When it last connected or disconnected, in epoch milliseconds. */
  lastSeenAt: number | null
  connected: boolean
}

export type RemoteAccess = {
  enabled: boolean
  /** Fixed, so `tailscale serve` has a stable target. */
  port: number
  /** Why the listener isn't running although enabled, such as the port being in use. */
  error: string | null
  /** The code a device can pair with, while one is waiting. */
  pairing: { code: string; expiresAt: number } | null
  devices: PairedDevice[]
  tailscale: TailscaleState
}

/** Whether the `tailscale` command can publish the listener, and where it has. */
export type TailscaleState = { available: boolean; url: string | null }

/** Where the browser's push service delivers messages for it, and the keys to encrypt them to it. */
export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } }

/** A paired device to notify. */
export type PushTarget = { deviceId: string; subscription: PushSubscription }

/** A notification for a phone, and the session tapping it goes to. */
export type PushPayload = {
  title: string
  body: string
  session: SessionTarget
}

export const defaultRemotePort = 4729

/** Where a browser asks to pair, with `{ code, name }`, and gets `{ token }` back. */
export const pairPath = '/pair'
