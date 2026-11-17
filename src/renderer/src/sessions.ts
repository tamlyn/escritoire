import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  type AgentKind,
  applyEvent,
  type SessionEvent,
  type SessionPointer,
  type SessionSummary,
  type SessionView,
  type SettingChoices,
} from '../../shared/agent'
import { api, subscribe } from './api'

let summaries: SessionSummary[] = []
const summaryListeners = new Set<() => void>()

function setSummaries(next: SessionSummary[]) {
  summaries = next
  for (const listener of summaryListeners) listener()
}

// The initial list mustn't overwrite a newer one pushed while it was loading.
let pushed = false
subscribe('sessionsChanged', (next) => {
  pushed = true
  setSummaries(next)
})
void api.getSessionSummaries().then((initial) => pushed || setSummaries(initial))

/** Live state of every loaded session, across all projects. */
export function useSessionSummaries(): SessionSummary[] {
  return useSyncExternalStore(
    (listener) => {
      summaryListeners.add(listener)
      return () => summaryListeners.delete(listener)
    },
    () => summaries,
  )
}

export function useSessionSummary(agentSessionId: string): SessionSummary | undefined {
  return useSessionSummaries().find((s) => s.agentSessionId === agentSessionId)
}

/** `movedTo` is the session the conversation continues in after the agent reset it. */
export type OpenSession = { view: SessionView; draft: string; movedTo?: string }

/**
 * Opens a session in main and keeps a local copy of its view, folding in the
 * events main forwards after the snapshot.
 */
export function useSession(projectId: string, pointer: SessionPointer): OpenSession | null {
  const [state, setState] = useState<OpenSession | null>(null)
  const { agent, agentSessionId } = pointer

  useEffect(() => {
    const session = { agent, agentSessionId }
    let seq: number | undefined
    // Events can arrive before the snapshot does; hold them until it has.
    const early: SessionEvent[] = []

    const unsubscribe = subscribe('sessionEvent', (message) => {
      if (message.agentSessionId !== agentSessionId) return
      if (seq === undefined) {
        early.push(message)
        return
      }
      if (message.seq <= seq) return
      seq = message.seq
      const { event } = message
      setState((current) => current && {
        ...current,
        view: applyEvent(current.view, event),
        ...(event.type === 'conversationReset' ? { movedTo: event.agentSessionId } : {}),
      })
    })

    void api.openSession(projectId, session).then((opened) => {
      seq = opened.seq
      const later = early.filter((e) => e.seq > opened.seq)
      if (later.length > 0) seq = later[later.length - 1]!.seq
      const reset = later.findLast((e) => e.event.type === 'conversationReset')?.event
      setState({
        view: later.reduce((view, e) => applyEvent(view, e.event), opened.view),
        draft: opened.draft,
        ...(reset?.type === 'conversationReset' ? { movedTo: reset.agentSessionId } : {}),
      })
    })

    return () => {
      unsubscribe()
      void api.closeSessionView(session)
    }
  }, [projectId, agent, agentSessionId])

  return state
}

const settingChoices = new Map<string, Promise<SettingChoices>>()

/** The agent's models and modes, asked for once per agent. */
export function useSettingChoices(projectId: string, agent: AgentKind): SettingChoices | null {
  const [choices, setChoices] = useState<SettingChoices | null>(null)
  useEffect(() => {
    let current = settingChoices.get(agent)
    if (!current) {
      current = api.getSettingChoices(projectId, agent)
      settingChoices.set(agent, current)
      // Asked again next time rather than failing for the rest of the app's life.
      current.catch(() => settingChoices.delete(agent))
    }
    let cancelled = false
    current.then((loaded) => cancelled || setChoices(loaded)).catch((error: unknown) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [projectId, agent])
  return choices
}
