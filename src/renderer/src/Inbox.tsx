import { BellIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SessionSummary } from '../../shared/agent'
import type { Project } from '../../shared/api'
import { needingAttention } from '../../shared/attention'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { enablePush, pushOffer } from './remote/push'
import { SessionIndicator } from './session/SessionIndicator'
import { statusDotColors } from './session/status-dot-colors'
import { useSessionSummaries } from './sessions'

type Props = {
  projects: Project[]
  onSelect: (session: SessionSummary) => void
}

/** Sessions in every project that need the user, to jump straight to one. */
export function Inbox({ projects, onSelect }: Props) {
  const summaries = useSessionSummaries()
  const sessions = useMemo(() => needingAttention(summaries), [summaries])
  const [offer, setOffer] = useState(pushOffer)
  const [pushFailed, setPushFailed] = useState(false)

  function turnOnNotifications() {
    enablePush().then(() => setOffer(pushOffer()), (error: unknown) => {
      console.error(error)
      setPushFailed(true)
    })
  }

  const waiting = sessions.some((s) => s.attention === 'waiting')
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={sessions.length === 0 ? 'Inbox' : `${sessions.length} ${sessions.length === 1 ? 'session needs' : 'sessions need'} you`}
        title="Sessions that need you"
        className="hover:bg-accent text-muted-foreground hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-sm px-1.5 text-xs [-webkit-app-region:no-drag]"
      >
        {sessions.length === 0 ? (
          <BellIcon className="size-3.5" />
        ) : (
          <>
            <span className={`size-1.5 rounded-full ${waiting ? statusDotColors.waiting : statusDotColors.unread}`} />
            {sessions.length}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-96">
        {sessions.length === 0 && <DropdownMenuItem disabled>No sessions need you</DropdownMenuItem>}
        {sessions.map((session) => (
          <DropdownMenuItem key={session.agentSessionId} onSelect={() => onSelect(session)}>
            <SessionIndicator summary={session} />
            <span className="truncate">{session.title || 'New session'}</span>
            <span className="text-muted-foreground ml-auto shrink-0 pl-2 text-xs">{projectName(session.projectId)}</span>
          </DropdownMenuItem>
        ))}
        {offer === 'enable' && (
          <DropdownMenuItem onSelect={turnOnNotifications}>
            {pushFailed ? "Couldn't turn on notifications. Try again" : 'Notify this phone'}
          </DropdownMenuItem>
        )}
        {offer === 'install' && <DropdownMenuItem disabled>Add to Home Screen to get notifications</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
