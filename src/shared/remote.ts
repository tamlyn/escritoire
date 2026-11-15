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
}

export const defaultRemotePort = 4729

/** Where a browser asks to pair, with `{ code, name }`, and gets `{ token }` back. */
export const pairPath = '/pair'
