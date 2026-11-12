import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  applyEvent,
  type SessionEvent,
  type SessionPointer,
  type SessionSummary,
  type SessionView,
} from '../../shared/agent'
import { api, subscribe } from './api'

let summaries: SessionSummary[] = []
const summaryListeners = new Set<() => void>()

function setSummaries(next: SessionSummary[]) {
  summaries = next
  for (const listener of summaryListeners) listener()
}

subscribe('sessionsChanged', setSummaries)
void api.getSessionSummaries().then(setSummaries)

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

export type OpenSession = { view: SessionView; draft: string }

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
      setState((current) => current && { ...current, view: applyEvent(current.view, message.event) })
    })

    void api.openSession(projectId, session).then((opened) => {
      seq = opened.seq
      const later = early.filter((e) => e.seq > opened.seq)
      if (later.length > 0) seq = later[later.length - 1]!.seq
      setState({
        view: later.reduce((view, e) => applyEvent(view, e.event), opened.view),
        draft: opened.draft,
      })
    })

    return () => {
      unsubscribe()
      void api.closeSessionView(session)
    }
  }, [projectId, agent, agentSessionId])

  return state
}
