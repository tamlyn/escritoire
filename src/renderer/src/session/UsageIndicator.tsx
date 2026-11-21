import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ContextUsage, PlanLimit } from '../../../shared/agent'

const categoryColors = ['bg-blue-500', 'bg-orange-500', 'bg-emerald-500', 'bg-violet-500', 'bg-pink-500', 'bg-cyan-500', 'bg-lime-500']
const reservedColor = 'bg-muted-foreground/40'
const closeDelayMs = 150

/** A doughnut of how full the context is, opening on hover (or tap) to the breakdown and the plan's limits. */
export function UsageIndicator({ usage, limits }: { usage?: ContextUsage; limits?: PlanLimit[] }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Touch has no hover, so a tap toggles it instead.
  const hover = (inside: boolean) => (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearTimeout(closeTimer.current)
    if (inside) setOpen(true)
    else closeTimer.current = setTimeout(() => setOpen(false), closeDelayMs)
  }
  if (!usage && !limits?.length) return null
  const fraction = usage?.contextWindow ? usage.contextTokens / usage.contextWindow : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Context and plan usage"
        className="hover:bg-muted hover:text-foreground data-[state=open]:bg-muted flex items-center gap-1.5 rounded px-1.5 py-1 outline-none"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        // With a mouse, hovering already opened it; a click toggling would close it.
        onClick={(event) => {
          if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') event.preventDefault()
        }}
      >
        {fraction !== undefined ? (
          <Doughnut fraction={fraction} />
        ) : usage ? (
          `${compact(usage.contextTokens)} context`
        ) : (
          'Usage'
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 space-y-4 text-xs"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {usage && <ContextSection usage={usage} />}
        {limits && limits.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-muted-foreground font-medium">Plan usage</h3>
            {limits.map((limit) => (
              <LimitRow key={limit.label} limit={limit} />
            ))}
          </section>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Doughnut({ fraction }: { fraction: number }) {
  const radius = 6
  const circumference = 2 * Math.PI * radius
  // Compaction usually comes well before a large window fills, so the low end is stretched to stay legible.
  const filled = Math.min(fraction, 1) ** 0.7 * circumference
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="3" className="stroke-muted-foreground/25" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeDasharray={`${filled} ${circumference}`}
        className={fraction >= 0.8 ? 'stroke-amber-500' : 'stroke-blue-500'}
      />
    </svg>
  )
}

function ContextSection({ usage }: { usage: ContextUsage }) {
  const { contextTokens, contextWindow, categories } = usage
  const scale = contextWindow ?? Math.max(contextTokens, 1)
  let colorIndex = 0
  const segments = (categories ?? [{ name: 'Used', tokens: contextTokens, reserved: false }]).map((category) => ({
    ...category,
    color: category.reserved ? reservedColor : categoryColors[colorIndex++ % categoryColors.length]!,
  }))
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-foreground text-sm font-medium">Context window</h3>
        {contextWindow && <span className="text-muted-foreground">{percent(contextTokens / contextWindow)} used</span>}
      </div>
      <Bar segments={segments.map((s) => ({ color: s.color, fraction: s.tokens / scale }))} />
      <p className="text-muted-foreground">
        {contextTokens.toLocaleString()}
        {contextWindow && ` of ${contextWindow.toLocaleString()}`} tokens
      </p>
      {categories && (
        <ul className="space-y-1">
          {segments.map((segment) => (
            <li key={segment.name} className="flex items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-full', segment.color)} />
              <span className="flex-1 truncate">{segment.name}</span>
              <span className="text-muted-foreground tabular-nums">{segment.tokens.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LimitRow({ limit }: { limit: PlanLimit }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground font-medium">{limit.label}</span>
        <span className="text-muted-foreground">{Math.round(limit.usedPercent)}% used</span>
      </div>
      <Bar
        segments={[{ color: limit.usedPercent >= 80 ? 'bg-amber-500' : 'bg-blue-500', fraction: limit.usedPercent / 100 }]}
      />
      {limit.resetsAt && <p className="text-muted-foreground">Resets {resetTime(limit.resetsAt)}</p>}
    </div>
  )
}

function Bar({ segments }: { segments: { color: string; fraction: number }[] }) {
  return (
    <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
      {segments.map((segment, index) => (
        <div key={index} className={segment.color} style={{ width: `${Math.min(segment.fraction, 1) * 100}%` }} />
      ))}
    </div>
  )
}

export function resetTime(at: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { timeStyle: 'short' })
  return at - Date.now() < 24 * 60 * 60_000
    ? `at ${time}`
    : `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function compact(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}
