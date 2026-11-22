import type { ProcessInfo } from '../../../shared/process'

/** Green while running, red if it failed; nothing once it has ended normally. */
export function ProcessStatusDot({ process }: { process: ProcessInfo }) {
  if (process.status === 'running') {
    return <span role="img" aria-label="Running" className="bg-primary size-1.5 shrink-0 rounded-full" />
  }
  if (process.status === 'failed') {
    return <span role="img" aria-label="Failed" className="bg-destructive size-1.5 shrink-0 rounded-full" />
  }
  return null
}
