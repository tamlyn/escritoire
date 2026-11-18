import { ChevronsUpDownIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState } from '../../shared/api'
import { api, isDesktop, rememberActiveProject, subscribe } from './api'
import { Inbox } from './Inbox'
import { useIsCompact } from './phone/compact'
import { PhoneWorkspace } from './phone/PhoneWorkspace'
import { ProjectSwitcher } from './ProjectSwitcher'
import { type PendingSession, ProjectWorkspace, type ProjectWorkspaceHandle } from './ProjectWorkspace'
import { RemoteAccessButton } from './remote/RemoteAccessButton'
import { isMac, modifierLabel, useShortcut } from './shortcuts'

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null)
  const workspaceRef = useRef<ProjectWorkspaceHandle>(null)
  const activeProjectId = state?.activeProjectId
  const compact = useIsCompact()

  useEffect(() => {
    // Pushes and replies arrive in the order main sent them, so whichever comes last is current.
    const unsubscribe = subscribe('stateChanged', setState)
    void api.getState().then(setState)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (activeProjectId !== undefined) rememberActiveProject(activeProjectId)
  }, [activeProjectId])

  /** Switches to the session's project if need be, then shows the session there. */
  const goToSession = useCallback((session: PendingSession) => {
    setPendingSession(session)
    if (session.projectId === activeProjectId) return
    void api.activateProject(session.projectId).then(setState, (error: unknown) => {
      console.error(error)
      setPendingSession(null)
    })
  }, [activeProjectId])

  useEffect(() => subscribe('focusSession', goToSession), [goToSession])

  const clearPendingSession = useCallback(() => setPendingSession(null), [])

  useShortcut('o', () => setSwitcherOpen(true))

  if (!state) return null

  const activeProject = state.projects.find((p) => p.id === state.activeProjectId)

  return (
    <div className="flex h-full flex-col">
      <header
        className={`bg-chrome flex h-10 shrink-0 items-center border-b px-2 [-webkit-app-region:drag] compact:box-content compact:pt-[env(safe-area-inset-top)] ${isDesktop && isMac ? 'pl-20' : ''}`}
        // Clear of the window controls drawn over the header on Windows and Linux.
        style={isDesktop ? { paddingRight: 'calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%) + 0.5rem)' } : undefined}
      >
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          title={`Switch project or open a file (${modifierLabel}O)`}
          className="hover:bg-accent flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium [-webkit-app-region:no-drag]"
        >
          {activeProject?.name ?? 'No project'}
          <ChevronsUpDownIcon className="text-muted-foreground size-3.5" />
        </button>
        <Inbox
          projects={state.projects}
          activeProjectId={compact ? null : state.activeProjectId}
          onSelect={(s) => goToSession({ projectId: s.projectId, pointer: { agent: s.agent, agentSessionId: s.agentSessionId }, title: s.title })}
        />
        {isDesktop && (
          <div className="ml-auto">
            <RemoteAccessButton />
          </div>
        )}
      </header>
      <main className="min-h-0 flex-1">
        {activeProject && compact ? (
          <PhoneWorkspace
            key={activeProject.id}
            project={activeProject}
            pendingSession={pendingSession}
            onPendingSessionShown={clearPendingSession}
          />
        ) : activeProject ? (
          <ProjectWorkspace
            key={activeProject.id}
            project={activeProject}
            pendingSession={pendingSession}
            onPendingSessionShown={clearPendingSession}
            ref={workspaceRef}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            {compact ? 'Tap No project to open one' : `Press ${modifierLabel}O to open a project`}
          </div>
        )}
      </main>
      <ProjectSwitcher
        state={state}
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        onActivate={(id) => void api.activateProject(id).then(setState)}
        onOpenPath={(path) => api.openProject(path).then(setState)}
        onOpenFile={(path) => workspaceRef.current?.openFile(path)}
        onClose={(id) => void api.closeProject(id).then(setState)}
        onRemove={(id) => void api.removeProject(id).then(setState)}
      />
    </div>
  )
}
