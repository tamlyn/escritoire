import { ChevronLeftIcon, FolderTreeIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import type { PastSession, SessionPointer, SessionSummary } from '../../../shared/agent'
import type { Project } from '../../../shared/api'
import { baseName } from '../../../shared/files'
import { api } from '../api'
import { FileActionsProvider } from '../file-actions'
import { FileView } from '../file/FileView'
import { FileTree } from '../FileTree'
import { ProjectContext } from '../project-context'
import type { PendingSession, ProjectWorkspaceHandle } from '../ProjectWorkspace'
import { SessionIndicator } from '../session/SessionIndicator'
import { SessionView } from '../session/SessionView'
import { NewSessionButton, NewTerminalButton, PastSessionRow, startButton, useStartSession } from '../session/StartSession'
import { useSessionClosed, useSessionSummaries, useSessionSummary } from '../sessions'
import { TabErrorBoundary } from '../TabErrorBoundary'
import { createTerminalTab } from '../tabs'
import { PhoneTerminal } from './PhoneTerminal'
import {
  forgetStartedTerminal,
  listSessions,
  openViewIn,
  type FilesPhoneView,
  type PhoneView,
  rememberOpenView,
  rememberStartedTerminal,
  type SessionPhoneView,
  startedTerminalsIn,
  terminalsIn,
} from './phone-views'

type Props = {
  project: Project
  pendingSession: PendingSession | null
  onPendingSessionShown: () => void
  ref?: Ref<ProjectWorkspaceHandle>
}

type Show = (view: PhoneView | null) => void

const files: FilesPhoneView = { kind: 'files' }

/**
 * A project on a phone: a home listing what's open, or one thing full screen.
 * A project's saved layout belongs to the desktop, so this only ever reads it,
 * to offer the desktop's terminals.
 */
export function PhoneWorkspace({ project, pendingSession, onPendingSessionShown, ref }: Props) {
  const [view, setView] = useState(() => openViewIn(project.id))

  const show = useCallback<Show>((next) => {
    rememberOpenView(project.id, next)
    setView(next)
  }, [project.id])

  useImperativeHandle(ref, () => ({
    openFile: (path) => show({ kind: 'file', path, from: view?.kind === 'session' || view?.kind === 'files' ? view : null }),
  }), [show, view])

  useEffect(() => {
    if (pendingSession?.projectId !== project.id) return
    show({ kind: 'session', pointer: pendingSession.pointer, title: pendingSession.title })
    onPendingSessionShown()
  }, [pendingSession, project.id, show, onPendingSessionShown])

  return (
    <ProjectContext.Provider value={project}>
      <FileActionsProvider openFile={(path) => show({ kind: 'file', path, from: files })}>
        {view?.kind === 'session' ? (
          <OpenSession key={view.pointer.agentSessionId} view={view} onShow={show} />
        ) : view?.kind === 'files' ? (
          <Screen title="Files" onBack={() => show(null)}>
            <FileTree onOpenFile={(path) => show({ kind: 'file', path, from: files })} />
          </Screen>
        ) : view?.kind === 'file' ? (
          <OpenFile key={view.path} path={view.path} onBack={() => show(view.from)} />
        ) : view?.kind === 'terminal' ? (
          <Screen title={view.title} onBack={() => show(null)}>
            <PhoneTerminal key={view.terminalId} terminalId={view.terminalId} />
          </Screen>
        ) : (
          <TabErrorBoundary>
            <ProjectHome projectId={project.id} onOpen={show} />
          </TabErrorBoundary>
        )}
      </FileActionsProvider>
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
      <div className="bg-chrome flex h-11 shrink-0 items-center gap-1.5 border-b pr-3 text-[15px]">
        <button type="button" aria-label="Back" onClick={onBack} className="flex size-11 shrink-0 items-center justify-center">
          <ChevronLeftIcon className="size-5" />
        </button>
        {indicator}
        <span className="min-w-0 truncate font-medium">{title}</span>
      </div>
      {/* Inside the header, so Back still leaves a view that has stopped working. */}
      <div className="min-h-0 flex-1"><TabErrorBoundary>{children}</TabErrorBoundary></div>
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
  const openFile = useCallback((path: string) => onShow({ kind: 'file', path, from: view }), [view, onShow])

  // Closed on another client, such as by closing its desktop tab.
  useSessionClosed(pointer.agentSessionId, () => onShow(null))

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
        position={{}}
        blame={blame}
        onBlameChange={setBlame}
        onPositionChanged={() => {}}
        onOpenCommit={() => {}}
      />
    </Screen>
  )
}

const pastSessionsLifetimeMs = 30_000
const recentPastSessions = new Map<string, { at: number; sessions: Promise<PastSession[]> }>()

/** Listing Codex's sessions starts a process, which going back to the list shouldn't do every time. */
function pastSessionsOf(projectId: string): Promise<PastSession[]> {
  const recent = recentPastSessions.get(projectId)
  if (recent && Date.now() - recent.at < pastSessionsLifetimeMs) return recent.sessions
  const sessions = api.listPastSessions(projectId)
  recentPastSessions.set(projectId, { at: Date.now(), sessions })
  sessions.catch(() => recentPastSessions.delete(projectId))
  return sessions
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="text-muted-foreground mb-1 px-2.5 text-[13px] font-medium">{title}</h2>
      {children}
    </section>
  )
}

const rowButton = 'hover:bg-accent flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2.5 text-left'

function TerminalRow({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={rowButton}>
      <SquareTerminalIcon className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </button>
  )
}

/** Something open, which closing stops, as closing its desktop tab would. */
function OpenRow({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center">
      {children}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="text-muted-foreground hover:bg-accent flex size-11 shrink-0 items-center justify-center rounded-sm"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

function closeSession(session: SessionSummary) {
  if (session.status === 'working' && !confirm(`${session.title || 'This session'} is still working. Stop it and close it?`)) return
  void api.closeSession({ agent: session.agent, agentSessionId: session.agentSessionId })
}

function ProjectHome({ projectId, onOpen }: { projectId: string; onOpen: Show }) {
  const summaries = useSessionSummaries()
  const [pastSessions, setPastSessions] = useState<PastSession[]>([])
  const [terminals, setTerminals] = useState<{ id: string; title: string }[]>([])
  const { starting, startError, start } = useStartSession(projectId, (pointer) => onOpen({ kind: 'session', pointer, title: '' }))

  useEffect(() => {
    let cancelled = false
    pastSessionsOf(projectId).then(
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
  const [started, setStarted] = useState(() => startedTerminalsIn(projectId))
  const openSession = ({ agent, agentSessionId, title }: SessionPointer & { title: string }) =>
    onOpen({ kind: 'session', pointer: { agent, agentSessionId }, title })
  const openTerminal = (terminalId: string, title: string) => onOpen({ kind: 'terminal', terminalId, title })

  function startTerminal() {
    const terminalId = createTerminalTab().id
    rememberStartedTerminal(projectId, terminalId)
    openTerminal(terminalId, 'Terminal')
  }

  // Nothing else would ever close a terminal the phone started.
  function closeTerminal(terminalId: string) {
    forgetStartedTerminal(projectId, terminalId)
    setStarted(startedTerminalsIn(projectId))
    void api.closeTerminal(projectId, terminalId)
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-2 py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[15px]">
      {(loaded.length > 0 || started.length > 0) && (
        <Section title="Open">
          {loaded.map((session) => (
            <OpenRow key={session.agentSessionId} title={session.title || 'New session'} onClose={() => closeSession(session)}>
              <button type="button" onClick={() => openSession(session)} className={rowButton}>
                <SessionIndicator summary={session} />
                <span className="min-w-0 flex-1 truncate">{session.title || 'New session'}</span>
              </button>
            </OpenRow>
          ))}
          {started.map((terminalId, index) => {
            const title = `Terminal ${index + 1}`
            return (
              <OpenRow key={terminalId} title={title} onClose={() => closeTerminal(terminalId)}>
                <TerminalRow title={title} onOpen={() => openTerminal(terminalId, title)} />
              </OpenRow>
            )
          })}
        </Section>
      )}
      <div className="flex flex-col">
        <NewSessionButton agent="claude" starting={starting} onStart={(agent) => void start(agent)} />
        <NewSessionButton agent="codex" starting={starting} onStart={(agent) => void start(agent)} />
        <NewTerminalButton onClick={startTerminal} />
        <button type="button" onClick={() => onOpen(files)} className={startButton}>
          <FolderTreeIcon className="text-muted-foreground size-4" />
          <span>Files</span>
        </button>
        {startError && <p role="alert" className="text-destructive px-2.5 pt-1 text-sm">{startError}</p>}
      </div>
      {terminals.length > 0 && (
        <Section title="Desktop terminals">
          {terminals.map(({ id, title }) => <TerminalRow key={id} title={title} onOpen={() => openTerminal(id, title)} />)}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Recent sessions">
          {past.map((session) => <PastSessionRow key={session.agentSessionId} session={session} onOpen={() => openSession(session)} />)}
        </Section>
      )}
    </div>
  )
}
