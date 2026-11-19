import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { PairedDevice, RemoteAccess } from '../../../shared/remote'
import { api, errorMessage, subscribe } from '../api'

/** Turns remote access on and off, pairs devices and lists them. Desktop only. */
export function RemoteAccessDialog({ onClose }: { onClose: () => void }) {
  const remote = useRemoteAccess()
  return remote && <RemoteAccessForm remote={remote} onClose={onClose} />
}

/** Fetched as the dialog opens, since Tailscale may have changed since it last did. */
function useRemoteAccess(): RemoteAccess | null {
  const [remote, setRemote] = useState<RemoteAccess | null>(null)
  useEffect(() => {
    // Pushes and replies arrive in the order main sent them, so whichever comes last is current.
    const unsubscribe = subscribe('remoteAccessChanged', setRemote)
    void api.getRemoteAccess().then(setRemote)
    return unsubscribe
  }, [])
  return remote
}

function RemoteAccessForm({ remote, onClose }: { remote: RemoteAccess; onClose: () => void }) {
  const [port, setPort] = useState(String(remote.port))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listening = remote.enabled && !remote.error

  async function attempt(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function turnOn(event: FormEvent) {
    event.preventDefault()
    const number = /^\d+$/.test(port.trim()) ? Number(port) : NaN
    if (!(number >= 1 && number <= 65535)) return setError('The port must be a number from 1 to 65535.')
    void attempt(() => api.changeRemoteAccess({ enabled: true, port: number }))
  }

  const turnOff = () => void attempt(() => api.changeRemoteAccess({ enabled: false, port: remote.port }))

  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remote access</DialogTitle>
          <DialogDescription>Use Escritoire from your phone or another computer on your Tailscale network.</DialogDescription>
        </DialogHeader>

        {listening ? (
          <div className="grid gap-2 text-sm">
            {remote.tailscale.url ? (
              <>
                <p>Published to your tailnet. Open this address on your phone:</p>
                <code className="bg-muted rounded-md px-2 py-1 select-all">{remote.tailscale.url}</code>
              </>
            ) : remote.tailscale.available ? (
              <>
                <p>Listening on port {remote.port}, but not yet published to your tailnet.</p>
                <Button variant="outline" className="justify-self-start" disabled={busy} onClick={() => void attempt(() => api.publishRemoteAccess())}>
                  Publish with Tailscale
                </Button>
              </>
            ) : (
              <>
                <p>Listening on port {remote.port}. To publish it to your tailnet over HTTPS, run:</p>
                <code className="bg-muted rounded-md px-2 py-1 select-all">tailscale serve --bg {remote.port}</code>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={turnOn} className="flex items-end gap-2">
            <label className="grid gap-1 text-sm">
              Port
              <Input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" className="w-24" />
            </label>
            <Button type="submit" disabled={busy}>
              Turn on
            </Button>
          </form>
        )}
        {(error ?? remote.error) && <p className="text-destructive text-sm">{error ?? remote.error}</p>}

        {listening &&
          (remote.pairing ? (
            <PairingCode {...remote.pairing} />
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => void attempt(() => api.startPairing())}>
              Pair a device
            </Button>
          ))}

        {remote.devices.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {remote.devices.map((device) => (
              <li key={device.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{device.name}</span>
                <span className="text-muted-foreground text-xs">{deviceStatus(device)}</span>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => void attempt(() => api.revokeDevice(device.id))}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {remote.enabled && (
          <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={turnOff}>
            Turn off
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PairingCode({ code, expiresAt }: { code: string; expiresAt: number }) {
  const now = useNow()
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return (
    <div className="grid gap-1 text-sm">
      <p>On the device, open this computer's tailnet address and enter:</p>
      <p aria-label="Pairing code" className="font-mono text-2xl tracking-widest">
        {code.slice(0, 3)} {code.slice(3)}
      </p>
      <p className="text-muted-foreground text-xs">
        Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </p>
    </div>
  )
}

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function deviceStatus(device: PairedDevice): string {
  if (device.connected) return 'Connected'
  return device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : 'Never connected'
}
