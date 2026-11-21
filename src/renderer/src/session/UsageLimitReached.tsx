import type { PlanLimit, QueuedMessage, SessionPointer } from '../../../shared/agent'
import { api } from '../api'
import { resetTime } from './UsageIndicator'

// Reset times are to the minute, so a little after is safely past.
const margin = 60_000

/**
 * With a plan limit used up, the agent can't go on until it resets, so this
 * offers to send "continue" then. Only when asked, since it spends the allowance
 * unattended.
 */
export function UsageLimitReached({ limits, queued, working, pointer }: {
  limits?: PlanLimit[]
  queued: QueuedMessage[]
  working: boolean
  pointer: SessionPointer
}) {
  const resetsAt = Math.max(
    ...(limits ?? []).flatMap((limit) => (limit.usedPercent >= 100 && limit.resetsAt && limit.resetsAt > Date.now() ? [limit.resetsAt] : [])),
  )
  if (working || !Number.isFinite(resetsAt) || queued.some((message) => message.sendAt)) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
      <span className="text-muted-foreground min-w-0 flex-1">Usage limit reached until {resetTime(resetsAt).replace(/^at /, '')}.</span>
      <button
        type="button"
        onClick={() => void api.scheduleMessage(pointer, { text: 'continue', images: [] }, resetsAt + margin)}
        className="hover:bg-muted shrink-0 rounded-md border px-2 py-0.5 text-xs"
      >
        Continue then
      </button>
    </div>
  )
}
