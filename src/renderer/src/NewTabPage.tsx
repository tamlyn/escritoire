import { FilePlusIcon, LoaderCircleIcon, MessageSquarePlusIcon, SquareTerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTab, useParentWorkspace } from 'react-resizable-panels'
import type { AgentKind, PastSession } from '../../shared/agent'
import { api } from './api'
import { useFileActions } from './file-actions'
import { relativeTime } from './lib/time'
import { useProject } from './project-context'
import { modifierLabel } from './shortcuts'
import { createFileTab, createSessionTab, createTerminalTab, type Tab, type TabData } from './tabs'

const maxPastSessions = 20
const agentNames: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const startButton =
  'hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2'

/** What an empty tab offers: start a session, or resume a recent one. */
export function NewTabPage({ tab }: { tab: Tab }) {
  const project = useProject()
  const workspace = useParentWorkspace<TabData>()
  const parentTab = useParentTab()
  const fileActions = useFileActions()
  const [pastSessions, setPastSessions] = useState<PastSession[] | null>(null)
  const [starting, setStarting] = useState<AgentKind | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

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

  // Codex starts its app-server and a thread before the tab can open, which can take seconds or fail.
  async function startSession(agent: AgentKind) {
    if (starting) return
    setStarting(agent)
    setStartError(null)
    try {
      const pointer = await api.createSession(project.id, agent)
      replaceWith(createSessionTab(pointer, ''))
    } catch (error) {
      setStartError(`Couldn't start the ${agentNames[agent]} session: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setStarting(null)
    }
  }

  function sessionButton(agent: AgentKind, autoFocus = false) {
    return (
      <button
        type="button"
        autoFocus={autoFocus}
        disabled={starting !== null}
        onClick={() => void startSession(agent)}
        className={startButton}
      >
        {starting === agent ? (
          <LoaderCircleIcon className="text-muted-foreground size-5 animate-spin" />
        ) : (
          <MessageSquarePlusIcon className="text-muted-foreground size-5" />
        )}
        <span className="font-medium">
          {starting === agent ? `Starting ${agentNames[agent]}…` : `New ${agentNames[agent]} session`}
        </span>
      </button>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          {sessionButton('claude', true)}
          {sessionButton('codex')}
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
              <button
                key={session.agentSessionId}
                type="button"
                onClick={() => replaceWith(createSessionTab(session, session.title))}
                className="hover:bg-accent focus-visible:bg-accent flex items-baseline gap-3 rounded-md px-2 py-1.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled session'}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {agentNames[session.agent]} · {relativeTime(session.lastActiveAt)}
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
