const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]
const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relativeTime(timestamp: number): string {
  const elapsed = timestamp - Date.now()
  for (const [unit, size] of units) {
    if (Math.abs(elapsed) >= size) return formatter.format(Math.round(elapsed / size), unit)
  }
  return 'just now'
}
