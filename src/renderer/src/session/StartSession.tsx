import { LoaderCircleIcon, MessageSquarePlusIcon, SquareTerminalIcon } from 'lucide-react'
import { useState } from 'react'
import type { AgentKind, PastSession, SessionPointer } from '../../../shared/agent'
import { api, errorMessage } from '../api'
import { relativeTime } from '../lib/time'

const agentNames: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
export const startButton =
  'hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2'

/** Codex starts its app-server and a thread before a session can open, which can take seconds or fail. */
export function useStartSession(projectId: string, onStarted: (pointer: SessionPointer) => void) {
  const [starting, setStarting] = useState<AgentKind | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  async function start(agent: AgentKind) {
    if (starting) return
    setStarting(agent)
    setStartError(null)
    try {
      onStarted(await api.createSession(projectId, agent))
    } catch (error) {
      setStartError(`Couldn't start the ${agentNames[agent]} session: ${errorMessage(error)}`)
    } finally {
      setStarting(null)
    }
  }

  return { starting, startError, start }
}

export function NewSessionButton({ agent, starting, onStart, autoFocus = false }: {
  agent: AgentKind
  starting: AgentKind | null
  onStart: (agent: AgentKind) => void
  autoFocus?: boolean
}) {
  return (
    <button type="button" autoFocus={autoFocus} disabled={starting !== null} onClick={() => onStart(agent)} className={startButton}>
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

export function NewTerminalButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={startButton}>
      <SquareTerminalIcon className="text-muted-foreground size-5" />
      <span className="font-medium">New terminal</span>
    </button>
  )
}

export function PastSessionRow({ session, onOpen }: { session: PastSession; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-accent focus-visible:bg-accent flex items-baseline gap-3 rounded-md px-2 py-1.5 text-left outline-none compact:py-2.5"
    >
      <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled session'}</span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {agentNames[session.agent]} · {relativeTime(session.lastActiveAt)}
      </span>
    </button>
  )
}
