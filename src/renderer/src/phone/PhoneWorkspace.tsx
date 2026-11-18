import { ChevronLeftIcon, SquareTerminalIcon } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PastSession } from '../../../shared/agent'
import type { Project } from '../../../shared/api'
import { baseName } from '../../../shared/files'
import { api } from '../api'
import { FileView } from '../file/FileView'
import { ProjectContext } from '../project-context'
import type { PendingSession, ProjectWorkspaceHandle } from '../ProjectWorkspace'
import { SessionIndicator } from '../session/SessionIndicator'
import { SessionView } from '../session/SessionView'
import { NewSessionButton, PastSessionRow, startButton, useStartSession } from '../session/StartSession'
import { useSessionSummaries, useSessionSummary } from '../sessions'
import { TabErrorBoundary } from '../TabErrorBoundary'
import { createTerminalTab } from '../tabs'
import { PhoneTerminal } from './PhoneTerminal'
import { listSessions, openViewIn, type PhoneView, rememberOpenView, type SessionPhoneView, terminalsIn } from './phone-views'

type Props = {
  project: Project
  pendingSession: PendingSession | null
  onPendingSessionShown: () => void
  ref?: Ref<ProjectWorkspaceHandle>
}

type Show = (view: PhoneView | null) => void

/**
 * A project on a phone: its sessions, or one thing full screen. A project's
 * saved layout belongs to the desktop, so this only ever reads it, to offer the
 * desktop's terminals.
 */
export function PhoneWorkspace({ project, pendingSession, onPendingSessionShown, ref }: Props) {
  const [view, setView] = useState(() => openViewIn(project.id))
  const current = useRef(view)

  const show = useCallback<Show>((next) => {
    const left = current.current
    // Nothing else would ever close a terminal the phone started.
    if (left?.kind === 'terminal' && left.startedHere && left.terminalId !== (next?.kind === 'terminal' ? next.terminalId : null)) {
      void api.closeTerminal(project.id, left.terminalId)
    }
    current.current = next
    rememberOpenView(project.id, next)
    setView(next)
  }, [project.id])

  useImperativeHandle(ref, () => ({ openFile: (path) => show({ kind: 'file', path, from: null }) }), [show])

  useEffect(() => {
    if (pendingSession?.projectId !== project.id) return
    show({ kind: 'session', pointer: pendingSession.pointer, title: pendingSession.title })
    onPendingSessionShown()
  }, [pendingSession, project.id, show, onPendingSessionShown])

  return (
    <ProjectContext.Provider value={project}>
      <TabErrorBoundary>
        {view?.kind === 'session' ? (
          <OpenSession key={view.pointer.agentSessionId} view={view} onShow={show} />
        ) : view?.kind === 'file' ? (
          <OpenFile key={view.path} path={view.path} onBack={() => show(view.from)} />
        ) : view?.kind === 'terminal' ? (
          <Screen title={view.title} onBack={() => show(null)}>
            <PhoneTerminal key={view.terminalId} terminalId={view.terminalId} />
          </Screen>
        ) : (
          <ProjectHome projectId={project.id} onOpen={show} />
        )}
      </TabErrorBoundary>
    </ProjectContext.Provider>
  )
}

function Screen({ title, indicator, onBack, children }: {
  title: string
  indicator?: React.ReactNode
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b pr-3">
        <button type="button" aria-label="Back" onClick={onBack} className="flex size-11 shrink-0 items-center justify-center">
          <ChevronLeftIcon className="size-5" />
        </button>
        {indicator}
        <span className="min-w-0 truncate font-medium">{title}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function OpenSession({ view, onShow }: { view: SessionPhoneView; onShow: Show }) {
  const { pointer, title } = view
  const summary = useSessionSummary(pointer.agentSessionId)
  const { agent } = pointer
  const follow = useCallback(
    (agentSessionId: string) => onShow({ kind: 'session', pointer: { agent, agentSessionId }, title }),
    [agent, title, onShow],
  )
  const viewRef = useRef(view)
  viewRef.current = view
  const openFile = useCallback((path: string) => onShow({ kind: 'file', path, from: viewRef.current }), [onShow])

  // Closed on another client, such as by closing its desktop tab.
  const wasLoaded = useRef(false)
  useEffect(() => {
    if (summary) wasLoaded.current = true
    else if (wasLoaded.current) onShow(null)
  }, [summary, onShow])

  return (
    <Screen title={summary?.title || title || 'New session'} indicator={<SessionIndicator summary={summary} />} onBack={() => onShow(null)}>
      <SessionView pointer={pointer} shown onMoved={follow} onOpenFile={openFile} />
    </Screen>
  )
}

function OpenFile({ path, onBack }: { path: string; onBack: () => void }) {
  const [blame, setBlame] = useState(false)
  return (
    <Screen title={baseName(path)} onBack={onBack}>
      <FileView
        path={path}
        scrollPos={undefined}
        blame={blame}
        onBlameChange={setBlame}
        onScrolled={() => {}}
        onOpenCommit={() => {}}
        onProcessStarted={() => {}}
      />
    </Screen>
  )
}

function ProjectHome({ projectId, onOpen }: { projectId: string; onOpen: Show }) {
  const summaries = useSessionSummaries()
  const [pastSessions, setPastSessions] = useState<PastSession[]>([])
  const [terminals, setTerminals] = useState<{ id: string; title: string }[]>([])
  const { starting, startError, start } = useStartSession(projectId, (pointer) => onOpen({ kind: 'session', pointer, title: '' }))

  useEffect(() => {
    let cancelled = false
    api.listPastSessions(projectId).then(
      (sessions) => { if (!cancelled) setPastSessions(sessions) },
      (error: unknown) => console.error(error),
    )
    api.loadLayout(projectId).then(
      (layout) => { if (!cancelled) setTerminals(terminalsIn(layout)) },
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
              onClick={() => onOpen({ kind: 'session', pointer: { agent: session.agent, agentSessionId: session.agentSessionId }, title: session.title })}
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
        <button
          type="button"
          onClick={() => onOpen({ kind: 'terminal', terminalId: createTerminalTab().id, title: 'Terminal', startedHere: true })}
          className={startButton}
        >
          <SquareTerminalIcon className="text-muted-foreground size-5" />
          <span className="font-medium">New terminal</span>
        </button>
        {startError && <p role="alert" className="text-destructive px-1 text-sm">{startError}</p>}
      </div>
      {terminals.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Desktop terminals</h2>
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              onClick={() => onOpen({ kind: 'terminal', terminalId: terminal.id, title: terminal.title, startedHere: false })}
              className="hover:bg-accent rounded-md px-2 py-2.5 text-left"
            >
              {terminal.title}
            </button>
          ))}
        </section>
      )}
      {past.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Recent sessions</h2>
          {past.map((session) => (
            <PastSessionRow
              key={session.agentSessionId}
              session={session}
              onOpen={() => onOpen({ kind: 'session', pointer: { agent: session.agent, agentSessionId: session.agentSessionId }, title: session.title })}
            />
          ))}
        </section>
      )}
    </div>
  )
}
