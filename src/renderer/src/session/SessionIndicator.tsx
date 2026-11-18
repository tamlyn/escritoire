import { LoaderCircleIcon } from 'lucide-react'
import type { SessionSummary } from '../../../shared/agent'
import { statusDotColors } from './status-dot-colors'

export function SessionIndicator({ summary }: { summary: SessionSummary | undefined }) {
  if (summary?.status === 'working' && summary.attention !== 'waiting') {
    return <LoaderCircleIcon aria-label="Working" className="size-3 shrink-0 animate-spin" />
  }
  const dot =
    summary?.attention === 'waiting'
      ? [statusDotColors.waiting, 'Waiting for input']
      : summary?.status === 'errored'
        ? [statusDotColors.errored, 'Errored']
        : summary?.attention === 'unread'
          ? [statusDotColors.unread, 'Unread']
          : null
  if (!dot) return null
  return <span role="img" aria-label={dot[1]} className={`size-2 shrink-0 rounded-full ${dot[0]}`} />
}
