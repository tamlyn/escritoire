import { CloudIcon, GitBranchIcon, TagIcon } from 'lucide-react'
import type { GitRef } from '../../../shared/git'

const styles: Record<GitRef['kind'], string> = {
  branch: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  remote: 'bg-muted text-muted-foreground',
  tag: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  head: 'bg-muted text-foreground',
}

const icons: Partial<Record<GitRef['kind'], typeof TagIcon>> = {
  branch: GitBranchIcon,
  remote: CloudIcon,
  tag: TagIcon,
}

const kindNames: Record<GitRef['kind'], string> = {
  branch: 'Branch',
  remote: 'Remote branch',
  tag: 'Tag',
  head: 'Detached HEAD',
}

/** Branch heads and tags pointing at a commit. */
export function RefLabels({ refs }: { refs: GitRef[] }) {
  return refs.map((ref) => {
    const Icon = icons[ref.kind]
    return (
      <span
        key={`${ref.kind}:${ref.name}`}
        title={`${kindNames[ref.kind]} ${ref.name}${ref.current ? ' (checked out)' : ''}`}
        className={`inline-flex max-w-48 shrink-0 items-center gap-1 rounded px-1.5 py-px text-xs ${styles[ref.kind]} ${
          ref.current ? 'ring-1 ring-current font-medium' : ''
        }`}
      >
        {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
        <span className="truncate">{ref.name}</span>
      </span>
    )
  })
}
