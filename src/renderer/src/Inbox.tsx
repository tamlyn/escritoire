import { BellIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SessionSummary } from '../../shared/agent'
import type { Project } from '../../shared/api'
import { needingAttention } from '../../shared/attention'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import { enablePush, type PushOffer, pushOffer } from './remote/push'
import { SessionIndicator } from './session/SessionIndicator'
import { statusDotColors } from './session/status-dot-colors'
import { useSessionSummaries } from './sessions'

type Props = {
  projects: Project[]
  /** The project whose tabs already show its sessions, if any. */
  activeProjectId: string | null
  onSelect: (session: SessionSummary) => void
}

/** Sessions that need the user and aren't on show in tabs. Hidden while there are none. */
export function Inbox({ projects, activeProjectId, onSelect }: Props) {
  const summaries = useSessionSummaries()
  const sessions = useMemo(
    () => needingAttention(summaries).filter((s) => s.projectId !== activeProjectId),
    [summaries, activeProjectId],
  )
  const [offer, setOffer] = useState<PushOffer>(pushOffer)
  const [pushFailed, setPushFailed] = useState(false)
  if (sessions.length === 0 && !offer) return null

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
        aria-label={sessions.length === 0 ? 'Notifications' : `${sessions.length} ${sessions.length === 1 ? 'session needs' : 'sessions need'} you`}
        title="Sessions that need you"
        className="hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs [-webkit-app-region:no-drag]"
      >
        {sessions.length === 0 ? (
          <BellIcon className="size-3.5" />
        ) : (
          <>
            <span className={`size-2 rounded-full ${waiting ? statusDotColors.waiting : statusDotColors.unread}`} />
            {sessions.length}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-96">
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
