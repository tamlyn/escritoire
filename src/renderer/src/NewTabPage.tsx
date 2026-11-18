import { FilePlusIcon, SquareTerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTab, useParentWorkspace } from 'react-resizable-panels'
import type { PastSession } from '../../shared/agent'
import { api } from './api'
import { useFileActions } from './file-actions'
import { useProject } from './project-context'
import { NewSessionButton, PastSessionRow, startButton, useStartSession } from './session/StartSession'
import { modifierLabel } from './shortcuts'
import { createFileTab, createSessionTab, createTerminalTab, type Tab, type TabData } from './tabs'

const maxPastSessions = 20

/** What an empty tab offers: start a session, or resume a recent one. */
export function NewTabPage({ tab }: { tab: Tab }) {
  const project = useProject()
  const workspace = useParentWorkspace<TabData>()
  const parentTab = useParentTab()
  const fileActions = useFileActions()
  const [pastSessions, setPastSessions] = useState<PastSession[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.listPastSessions(project.id).then((sessions) => {
      if (!cancelled) setPastSessions(sessions.slice(0, maxPastSessions))
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  function replaceWith(next: Tab) {
    if (!workspace || !parentTab) return
    workspace.addTab(next, { tabsetId: parentTab.getTabsetId() })
    workspace.closeTab(tab.id)
  }

  const { starting, startError, start } = useStartSession(project.id, (pointer) => replaceWith(createSessionTab(pointer, '')))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <NewSessionButton agent="claude" starting={starting} onStart={(agent) => void start(agent)} autoFocus />
          <NewSessionButton agent="codex" starting={starting} onStart={(agent) => void start(agent)} />
          <button type="button" onClick={() => replaceWith(createTerminalTab())} className={startButton}>
            <SquareTerminalIcon className="text-muted-foreground size-5" />
            <span className="font-medium">New terminal</span>
          </button>
          <button
            type="button"
            onClick={() => fileActions.newFile('', (path) => replaceWith(createFileTab(path)))}
            className={startButton}
          >
            <FilePlusIcon className="text-muted-foreground size-5" />
            <span className="font-medium">New file</span>
            <span className="text-muted-foreground ml-auto text-xs">{modifierLabel}N</span>
          </button>
          {startError && <p role="alert" className="text-destructive px-1 text-sm">{startError}</p>}
        </div>

        {pastSessions && pastSessions.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Recent sessions</h2>
            {pastSessions.map((session) => (
              <PastSessionRow key={session.agentSessionId} session={session} onOpen={() => replaceWith(createSessionTab(session, session.title))} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
