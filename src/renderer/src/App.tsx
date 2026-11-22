import { ChevronsUpDownIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionTarget } from '../../shared/agent'
import type { AppState } from '../../shared/api'
import { api, isDesktop, rememberActiveProject, subscribe } from './api'
import { AppMenu } from './AppMenu'
import { Inbox } from './Inbox'
import { useIsCompact } from './phone/compact'
import { PhoneWorkspace } from './phone/PhoneWorkspace'
import { ActionPalette } from './ActionPalette'
import { useCommand } from './commands'
import { ProjectSwitcher, type SwitcherMode } from './ProjectSwitcher'
import { type PendingSession, ProjectWorkspace, type ProjectWorkspaceHandle } from './ProjectWorkspace'
import { followNotifications, notificationSessionShown } from './remote/push'
import { revealLine } from './file/reveal'
import { ProjectSearch, selectedEditorText } from './search/ProjectSearch'
import { isMac, shortcutLabel } from './shortcuts'

const switchProjectShortcut = { key: 'p', shift: true }

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  // One at a time, so a palette's shortcut swaps to it from another.
  const [palette, setPalette] = useState<SwitcherMode | 'actions' | 'find' | null>(null)
  const [findSeed, setFindSeed] = useState<string | null>(null)
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
  useEffect(() => followNotifications(goToSession), [goToSession])

  const clearPendingSession = useCallback(() => {
    setPendingSession(null)
    notificationSessionShown()
  }, [])

  useCommand({ id: 'actions', title: 'Search actions', shortcut: { key: 'a', shift: true }, inDialogs: true, run: () => setPalette('actions') })
  useCommand({ id: 'switch-project', title: 'Switch project', shortcut: switchProjectShortcut, inDialogs: true, run: () => setPalette('project') })
  useCommand({
    id: 'open-file',
    title: 'Open file',
    shortcut: { key: 'o', shift: true },
    inDialogs: true,
    run: () => {
      if (activeProjectId) setPalette('file')
    },
  })

  useCommand({
    id: 'find-in-files',
    title: 'Find in files',
    shortcut: { key: 'f', shift: true },
    inDialogs: true,
    run: () => {
      if (!activeProjectId) return
      setFindSeed(selectedEditorText())
      setPalette('find')
    },
  })

  if (!state) return null

  const activeProject = state.projects.find((p) => p.id === state.activeProjectId)

  return (
    <div className="flex h-full flex-col">
      <header
        className={`bg-chrome text-ui flex h-10 shrink-0 items-center gap-0.5 border-b px-2 [-webkit-app-region:drag] compact:box-content compact:pt-[env(safe-area-inset-top)] ${isDesktop && isMac ? 'pl-20' : ''}`}
        // Clear of the window controls drawn over the header on Windows and Linux.
        style={isDesktop ? { paddingRight: 'calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%) + 0.5rem)' } : undefined}
      >
        <AppMenu />
        <Inbox projects={state.projects} onSelect={(s) => goToSession(sessionTarget(s))} />
        <button
          type="button"
          onClick={() => setPalette('project')}
          title={`Switch project or open a file (${shortcutLabel(switchProjectShortcut)})`}
          className="hover:bg-accent flex h-7 items-center gap-1.5 rounded-sm px-2 font-medium [-webkit-app-region:no-drag]"
        >
          {activeProject?.name ?? 'No project'}
          <ChevronsUpDownIcon className="text-muted-foreground size-3.5" />
        </button>
      </header>
      <main className="min-h-0 flex-1">
        {activeProject && compact ? (
          <PhoneWorkspace
            key={activeProject.id}
            project={activeProject}
            pendingSession={pendingSession}
            onPendingSessionShown={clearPendingSession}
            ref={workspaceRef}
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
            {compact ? 'Tap No project to open one' : `Press ${shortcutLabel(switchProjectShortcut)} to open a project`}
          </div>
        )}
      </main>
      <ProjectSwitcher
        state={state}
        mode={palette === 'project' || palette === 'file' ? palette : null}
        onOpenChange={(open) => open || setPalette(null)}
        onActivate={(id) => void api.activateProject(id).then(setState)}
        onOpenPath={(path) => api.openProject(path).then(setState)}
        onOpenFile={(path) => workspaceRef.current?.openFile(path)}
        onClose={(id) => void api.closeProject(id).then(setState)}
        onRemove={(id) => void api.removeProject(id).then(setState)}
      />
      <ActionPalette open={palette === 'actions'} onOpenChange={(open) => setPalette(open ? 'actions' : null)} />
      {activeProject && (
        <ProjectSearch
          projectId={activeProject.id}
          open={palette === 'find'}
          seed={findSeed}
          onOpenChange={(open) => setPalette(open ? 'find' : null)}
          onOpenResult={({ path, match }) => {
            workspaceRef.current?.openFile(path)
            // After the tab is shown, so an editor that was already open can scroll.
            requestAnimationFrame(() => revealLine(activeProject.id, path, match.line, match))
          }}
        />
      )}
    </div>
  )
}
