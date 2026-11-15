import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pairPath } from '../../../shared/remote'
import { errorMessage, rememberToken } from '../api'

/** Shown in a browser that hasn't paired, to pair with a code from the desktop. */
export function Pairing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const complete = code.replace(/\s/g, '').length === 6

  async function pair(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(pairPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: deviceName() }),
      })
      const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!body.token) throw new Error(body.error ?? `Pairing failed (${response.status}).`)
      rememberToken(body.token)
      location.reload()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={pair} className="grid w-full max-w-xs gap-4">
        <h1 className="text-lg font-medium">Pair with Escritoire</h1>
        <p className="text-muted-foreground text-sm">
          On the desktop, open remote access from the phone icon at the top right and choose Pair a device. Then enter
          the code it shows.
        </p>
        <Input
          aria-label="Pairing code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          maxLength={7}
          autoFocus
          className="text-center font-mono text-lg tracking-widest"
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={busy || !complete}>
          Pair
        </Button>
      </form>
    </div>
  )
}

const devices: [RegExp, string][] = [[/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Mac/, 'Mac'], [/Windows/, 'Windows'], [/Linux/, 'Linux']]
// In this order, as Edge's agent also names Chrome and Safari, and Chrome's names Safari.
const browsers: [RegExp, string][] = [[/Edg\//, 'Edge'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']]

/** A name for the desktop's list of paired devices. */
function deviceName(): string {
  const match = (names: [RegExp, string][]) => names.find(([pattern]) => pattern.test(navigator.userAgent))?.[1]
  return [match(devices) ?? 'Browser', match(browsers)].filter(Boolean).join(' ')
}
