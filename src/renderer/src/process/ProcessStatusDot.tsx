import type { ProcessInfo } from '../../../shared/process'

/** Green while running, red if it failed; nothing once it has ended normally. */
export function ProcessStatusDot({ process }: { process: ProcessInfo }) {
  if (process.status === 'running') {
    return <span role="img" aria-label="Running" className="size-2 shrink-0 rounded-full bg-emerald-500" />
  }
  if (process.status === 'failed') {
    return <span role="img" aria-label="Failed" className="bg-destructive size-2 shrink-0 rounded-full" />
  }
  return null
}
