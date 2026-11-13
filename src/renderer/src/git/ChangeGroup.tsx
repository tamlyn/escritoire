import { baseName, parentPath } from '../../../shared/files'
import type { GitChange } from '../../../shared/git'
import { statusColours } from './status'

/** A titled list of changed files; each opens its diff. */
export function ChangeGroup({
  title,
  changes,
  omitted = 0,
  onOpen,
}: {
  title: string
  changes: GitChange[]
  omitted?: number
  onOpen: (change: GitChange) => void
}) {
  if (changes.length === 0) return null
  return (
    <section aria-label={title}>
      <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">
        {title} <span className="tabular-nums">{changes.length + omitted}</span>
      </h2>
      <ul>
        {changes.map((change) => (
          <li key={change.path}>
            <button
              type="button"
              onClick={() => onOpen(change)}
              title={change.from ? `${change.path} (from ${change.from})` : change.path}
              className="hover:bg-accent focus-visible:bg-accent flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left outline-none"
            >
              <span className={`w-3 shrink-0 font-mono text-xs ${statusColours[change.status] ?? ''}`}>
                {change.status}
              </span>
              <span className="shrink-0">{baseName(change.path)}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{parentPath(change.path)}</span>
              <LineCounts lines={change.lines} />
            </button>
          </li>
        ))}
      </ul>
      {omitted > 0 && <p className="text-muted-foreground px-2 py-1 text-xs">and {omitted} more</p>}
    </section>
  )
}

function LineCounts({ lines }: { lines: GitChange['lines'] }) {
  if (lines === null) return null
  if (lines === 'binary') return <span className="text-muted-foreground shrink-0 text-xs">binary</span>
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      {lines.added > 0 && <span className="text-green-600 dark:text-green-400">+{lines.added}</span>}
      {lines.added > 0 && lines.removed > 0 && ' '}
      {lines.removed > 0 && <span className="text-red-600 dark:text-red-400">−{lines.removed}</span>}
    </span>
  )
}
