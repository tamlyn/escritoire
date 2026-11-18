import { powerMonitor } from 'electron'

const idleSeconds = 60
const checkEveryMs = 10_000

/**
 * Whether the user is at this computer: the screen unlocked and the system
 * used in the last minute. Calls `onChange` when that changes.
 */
export function watchPresence(onChange: (present: boolean) => void): void {
  let present = true
  const check = () => {
    const state = powerMonitor.getSystemIdleState(idleSeconds)
    const now = state !== 'idle' && state !== 'locked'
    if (now === present) return
    present = now
    onChange(present)
  }
  setInterval(check, checkEveryMs)
  // Locking is the clearest sign of leaving, so it isn't left to the next check.
  powerMonitor.on('lock-screen', check)
  powerMonitor.on('unlock-screen', check)
}
