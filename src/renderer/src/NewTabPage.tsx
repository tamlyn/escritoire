import { MessageSquarePlusIcon, SquareTerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTab, useParentWorkspace } from 'react-resizable-panels'
import type { PastSession } from '../../shared/agent'
import { api } from './api'
import { relativeTime } from './lib/time'
import { useProject } from './project-context'
import { createSessionTab, createTerminalTab, type Tab, type TabData } from './tabs'

const maxPastSessions = 20
const startButton =
  'hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2'

/** What an empty tab offers: start a session, or resume a recent one. */
export function NewTabPage({ tab }: { tab: Tab }) {
  const project = useProject()
  const workspace = useParentWorkspace<TabData>()
  const parentTab = useParentTab()
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

  async function startSession() {
    const pointer = await api.createSession(project.id, 'claude')
    replaceWith(createSessionTab(pointer, ''))
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col gap-8 overflow-y-auto px-6 py-16">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          autoFocus
          onClick={() => void startSession()}
          className={startButton}
        >
          <MessageSquarePlusIcon className="text-muted-foreground size-5" />
          <span className="font-medium">New Claude session</span>
        </button>
        <button type="button" onClick={() => replaceWith(createTerminalTab())} className={startButton}>
          <SquareTerminalIcon className="text-muted-foreground size-5" />
          <span className="font-medium">New terminal</span>
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
                {relativeTime(session.lastActiveAt)}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
