import { ChevronsUpDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/api'
import { api } from './api'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ProjectWorkspace } from './ProjectWorkspace'
import { isMac, modifierLabel, useShortcut } from './shortcuts'

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  useEffect(() => {
    void api.getState().then(setState)
  }, [])

  useShortcut('o', () => setSwitcherOpen(true))

  if (!state) return null

  const activeProject = state.projects.find((p) => p.id === state.activeProjectId)

  return (
    <div className="flex h-full flex-col">
      <header
        className={`bg-chrome flex h-10 shrink-0 items-center justify-center border-b [-webkit-app-region:drag] ${isMac ? 'pl-20' : ''}`}
      >
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          title={`Switch project (${modifierLabel}O)`}
          className="hover:bg-accent flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium [-webkit-app-region:no-drag]"
        >
          {activeProject?.name ?? 'No project'}
          <ChevronsUpDownIcon className="text-muted-foreground size-3.5" />
        </button>
      </header>
      <main className="min-h-0 flex-1">
        {activeProject ? (
          <ProjectWorkspace key={activeProject.id} project={activeProject} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            Press {modifierLabel}O to open a project
          </div>
        )}
      </main>
      <ProjectSwitcher
        state={state}
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        onActivate={(id) => void api.activateProject(id).then(setState)}
        onOpenPath={(path) => api.openProject(path).then(setState)}
        onClose={(id) => void api.closeProject(id).then(setState)}
        onRemove={(id) => void api.removeProject(id).then(setState)}
      />
    </div>
  )
}
