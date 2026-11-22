import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ContextUsage, SessionPointer } from '../../../shared/agent'
import { api, errorMessage } from '../api'

/** Cache lifetime after the latest request, with a manual request to refresh it. */
export function CacheIndicator({ pointer, usage, working }: { pointer: SessionPointer; usage: ContextUsage; working: boolean }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000)
    return () => { clearInterval(timer); clearTimeout(closeTimer.current) }
  }, [])

  const estimated = pointer.agent === 'codex'
  const ttl = estimated ? 30 * 60_000 : usage.cacheTtlMs ?? 5 * 60_000
  const expiresAt = usage.at + ttl
  const now = Math.max(clock, usage.at)
  const warm = working || now < expiresAt
  const guessed = estimated || !usage.cacheTtlMs
  // As with context usage, mouse hover opens it and a touch tap toggles it.
  const hover = (inside: boolean) => (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearTimeout(closeTimer.current)
    if (inside) setOpen(true)
    else closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  const request = async (call: () => Promise<void>) => {
    if (working || sending) return
    setError(null)
    setSending(true)
    try { await call() }
    catch (error) { setError(errorMessage(error)) }
    finally { setSending(false) }
  }
  const time = (at: number) => new Date(at).toLocaleTimeString([], { timeStyle: 'medium' })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Prompt cache"
        className="hover:bg-accent hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground flex h-6 items-center gap-1 rounded-sm px-1.5 outline-none"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onClick={(event) => {
          if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') event.preventDefault()
        }}
      >
        <span className={cn('size-1.5 rounded-full', warm ? 'bg-primary' : 'bg-muted-foreground/40')} />
        <span>
          {working ? 'Warm' : warm ? `${Math.ceil((expiresAt - now) / 60_000)}m` : 'Cold'}
          {estimated && !working ? '?' : ''}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        aria-label="Prompt cache details"
        className="w-80 space-y-3 text-xs"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Focusing the trigger on close would dismiss the context popover the pointer moved on to, and take focus from the composer.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <h3 className="text-foreground text-sm font-medium">Prompt cache</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Last request</dt>
          <dd><time dateTime={new Date(usage.at).toISOString()}>{time(usage.at)}</time></dd>
          <dt className="text-muted-foreground">{guessed ? 'Estimated expiry' : 'Expiry'}</dt>
          <dd><time dateTime={new Date(expiresAt).toISOString()}>{time(expiresAt)}</time></dd>
          <dt className="text-muted-foreground">Tokens read</dt>
          <dd>{usage.cacheReadTokens.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Tokens written</dt>
          <dd>{usage.cacheWriteTokens.toLocaleString()}</dd>
        </dl>
        <p className="text-muted-foreground">
          {estimated
            ? 'Assumes a 30-minute lifetime after the last request. Codex does not report expiry; actual retention may differ.'
            : `${ttl / 60_000}-minute lifetime after each request${usage.cacheTtlMs ? '' : ' (assumed)'}.`}
          {working && ' Requests during this turn keep it warm.'}
        </p>
        {warm ? (
          <div className="flex items-center gap-3 border-t pt-3">
            <p className="text-muted-foreground flex-1">Send a short message to extend the cache lifetime.</p>
            <Button type="button" variant="outline" size="xs" disabled={working || sending} onClick={() => void request(() => api.rewarmSession(pointer))}>Keep warm</Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2 border-t pt-3">
            <p className="text-muted-foreground">Start a new session from your messages and the agent's last reply, rather than resending the whole conversation to an empty cache.</p>
            <Button type="button" variant="outline" size="xs" disabled={sending} onClick={() => void request(() => api.continueInNewSession(pointer))}>Continue in new session</Button>
          </div>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}
