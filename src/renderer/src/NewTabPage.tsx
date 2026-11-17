import { FilePlusIcon, MessageSquarePlusIcon, SquareTerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTab, useParentWorkspace } from 'react-resizable-panels'
import type { PastSession } from '../../shared/agent'
import { api } from './api'
import { useFileActions } from './file-actions'
import { relativeTime } from './lib/time'
import { useProject } from './project-context'
import { modifierLabel } from './shortcuts'
import { createFileTab, createSessionTab, createTerminalTab, type Tab, type TabData } from './tabs'

const maxPastSessions = 20
const startButton =
  'hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2'

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

  async function startSession(agent: 'claude' | 'codex') {
    const pointer = await api.createSession(project.id, agent)
    replaceWith(createSessionTab(pointer, ''))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => void startSession('claude')}
            className={startButton}
          >
            <MessageSquarePlusIcon className="text-muted-foreground size-5" />
            <span className="font-medium">New Claude session</span>
          </button>
          <button type="button" onClick={() => void startSession('codex')} className={startButton}>
            <MessageSquarePlusIcon className="text-muted-foreground size-5" />
            <span className="font-medium">New Codex session</span>
          </button>
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
        </div>

        {pastSessions && pastSessions.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="text-muted-foreground mb-1 px-2 text-xs font-medium">Recent sessions</h2>
            {pastSessions.map((session) => (
              <button
                key={session.agentSessionId}
                type="button"
                onClick={() => replaceWith(createSessionTab(session, session.title))}
                className="hover:bg-accent focus-visible:bg-accent flex items-baseline gap-3 rounded-md px-2 py-1.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled session'}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {session.agent === 'codex' ? 'Codex · ' : 'Claude · '}{relativeTime(session.lastActiveAt)}
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
