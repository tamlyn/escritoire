import { LoaderCircleIcon } from 'lucide-react'
import type { SessionSummary } from '../../../shared/agent'

export function SessionIndicator({ summary }: { summary: SessionSummary | undefined }) {
  if (summary?.status === 'working' && summary.attention !== 'waiting') {
    return <LoaderCircleIcon aria-label="Working" className="size-3 shrink-0 animate-spin" />
  }
  const dot =
    summary?.attention === 'waiting'
      ? ['bg-amber-500', 'Waiting for input']
      : summary?.status === 'errored'
        ? ['bg-destructive', 'Errored']
        : summary?.attention === 'unread'
          ? ['bg-blue-500', 'Unread']
          : null
  if (!dot) return null
  return <span role="img" aria-label={dot[1]} className={`size-2 shrink-0 rounded-full ${dot[0]}`} />
}
