import { useMemo } from 'react'
import type { SessionSummary } from '../../shared/agent'
import type { Project } from '../../shared/api'
import { needingAttention } from '../../shared/attention'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { SessionIndicator } from './session/SessionIndicator'
import { useSessionSummaries } from './sessions'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelect: (session: SessionSummary) => void
}

/**
 * Sessions in other projects that need the user. The active project's are
 * left out, since its tabs show them. Hidden while there are none.
 */
export function Inbox({ projects, activeProjectId, onSelect }: Props) {
  const summaries = useSessionSummaries()
  const sessions = useMemo(
    () => needingAttention(summaries).filter((s) => s.projectId !== activeProjectId),
    [summaries, activeProjectId],
  )
  if (sessions.length === 0) return null

  const waiting = sessions.some((s) => s.attention === 'waiting')
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${sessions.length} ${sessions.length === 1 ? 'session needs' : 'sessions need'} you`}
        title="Sessions in other projects that need you"
        className="hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs [-webkit-app-region:no-drag]"
      >
        <span className={`size-2 rounded-full ${waiting ? 'bg-amber-500' : 'bg-blue-500'}`} />
        {sessions.length}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-96">
        {sessions.map((session) => (
          <DropdownMenuItem key={session.agentSessionId} onSelect={() => onSelect(session)}>
            <SessionIndicator summary={session} />
            <span className="truncate">{session.title || 'New session'}</span>
            <span className="text-muted-foreground ml-auto shrink-0 pl-2 text-xs">{projectName(session.projectId)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
