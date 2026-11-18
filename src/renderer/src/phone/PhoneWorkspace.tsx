import { ChevronLeftIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PastSession, SessionPointer } from '../../../shared/agent'
import type { Project } from '../../../shared/api'
import { api } from '../api'
import { ProjectContext } from '../project-context'
import type { PendingSession } from '../ProjectWorkspace'
import { SessionIndicator } from '../session/SessionIndicator'
import { SessionView } from '../session/SessionView'
import { NewSessionButton, PastSessionRow, useStartSession } from '../session/StartSession'
import { useSessionSummaries, useSessionSummary } from '../sessions'
import { listSessions, openSessionIn, rememberOpenSession } from './session-list'

type Props = {
  project: Project
  pendingSession: PendingSession | null
  onPendingSessionShown: () => void
}

/**
 * A project on a phone: its sessions, or one of them full screen. A project's
 * saved layout belongs to the desktop, so this never reads or writes it.
 */
export function PhoneWorkspace({ project, pendingSession, onPendingSessionShown }: Props) {
  const [open, setOpen] = useState(() => openSessionIn(project.id))

  const show = useCallback((pointer: SessionPointer | null) => {
    rememberOpenSession(project.id, pointer)
    setOpen(pointer)
  }, [project.id])

  useEffect(() => {
    if (pendingSession?.projectId !== project.id) return
    show(pendingSession.pointer)
    onPendingSessionShown()
  }, [pendingSession, project.id, show, onPendingSessionShown])

  return (
    <ProjectContext.Provider value={project}>
      {open ? <OpenSession key={open.agentSessionId} pointer={open} onShow={show} /> : <SessionList projectId={project.id} onOpen={show} />}
    </ProjectContext.Provider>
  )
}

function OpenSession({ pointer, onShow }: { pointer: SessionPointer; onShow: (pointer: SessionPointer | null) => void }) {
  const summary = useSessionSummary(pointer.agentSessionId)
  const { agent } = pointer
  const follow = useCallback((agentSessionId: string) => onShow({ agent, agentSessionId }), [agent, onShow])
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b pr-3">
        <button
          type="button"
          aria-label="Back to sessions"
          onClick={() => onShow(null)}
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <SessionIndicator summary={summary} />
        <span className="min-w-0 truncate font-medium">{summary?.title || 'New session'}</span>
      </div>
      <div className="min-h-0 flex-1">
        <SessionView pointer={pointer} shown onMoved={follow} />
      </div>
    </div>
  )
}

function SessionList({ projectId, onOpen }: { projectId: string; onOpen: (pointer: SessionPointer) => void }) {
  const summaries = useSessionSummaries()
  const [pastSessions, setPastSessions] = useState<PastSession[]>([])
  const { starting, startError, start } = useStartSession(projectId, onOpen)

  useEffect(() => {
    let cancelled = false
    api.listPastSessions(projectId).then(
      (sessions) => { if (!cancelled) setPastSessions(sessions) },
      (error: unknown) => console.error(error),
    )
    return () => { cancelled = true }
  }, [projectId])

  const { loaded, past } = listSessions(projectId, summaries, pastSessions)

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {loaded.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Sessions</h2>
          {loaded.map((session) => (
            <button
              key={session.agentSessionId}
              type="button"
              onClick={() => onOpen({ agent: session.agent, agentSessionId: session.agentSessionId })}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate">{session.title || 'New session'}</span>
              <SessionIndicator summary={session} />
            </button>
          ))}
        </section>
      )}
      <div className="flex flex-col gap-2">
        <NewSessionButton agent="claude" starting={starting} onStart={(agent) => void start(agent)} />
        <NewSessionButton agent="codex" starting={starting} onStart={(agent) => void start(agent)} />
        {startError && <p role="alert" className="text-destructive px-1 text-sm">{startError}</p>}
      </div>
      {past.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Recent sessions</h2>
          {past.map((session) => (
            <PastSessionRow
              key={session.agentSessionId}
              session={session}
              onOpen={() => onOpen({ agent: session.agent, agentSessionId: session.agentSessionId })}
            />
          ))}
        </section>
      )}
    </div>
  )
}
