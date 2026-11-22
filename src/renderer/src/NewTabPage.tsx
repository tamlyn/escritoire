import { FilePlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTab, useParentWorkspace } from 'react-resizable-panels'
import { maxPastSessions, type PastSession } from '../../shared/agent'
import { api } from './api'
import { useFileActions } from './file-actions'
import { useProject } from './project-context'
import { NewSessionButton, NewTerminalButton, PastSessionRow, startButton, useStartSession } from './session/StartSession'
import { modifierLabel } from './shortcuts'
import { createFileTab, createSessionTab, createTerminalTab, type Tab, type TabData } from './tabs'


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
      <div className="mx-auto flex max-w-[540px] flex-col gap-7 px-6 py-16" onKeyDown={moveFocusWithArrows}>
        <div className="flex flex-col gap-0.5">
          <NewSessionButton agent="claude" starting={starting} onStart={(agent) => void start(agent)} autoFocus />
          <NewSessionButton agent="codex" starting={starting} onStart={(agent) => void start(agent)} />
          <NewTerminalButton onClick={() => replaceWith(createTerminalTab())} />
          <button
            type="button"
            onClick={() => fileActions.newFile('', (path) => replaceWith(createFileTab(path)))}
            className={startButton}
          >
            <FilePlusIcon className="text-muted-foreground size-4" />
            <span>New file</span>
            <span className="text-muted-foreground ml-auto text-xs font-normal">{modifierLabel}N</span>
          </button>
          {startError && <p role="alert" className="text-destructive px-2.5 pt-1 text-sm">{startError}</p>}
        </div>

        {pastSessions && pastSessions.length > 0 && (
          <section className="flex flex-col gap-0.5">
            <h2 className="text-muted-foreground mb-1.5 px-2.5 text-xs font-medium">Recent sessions</h2>
            {pastSessions.map((session) => (
              <PastSessionRow key={session.agentSessionId} session={session} onOpen={() => replaceWith(createSessionTab(session, session.title))} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

/** Up and down move between the page's buttons, as in a menu, rather than scrolling. */
function moveFocusWithArrows(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if (buttons.length === 0) return
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), buttons.length - 1)
  buttons[next]!.focus()
}
