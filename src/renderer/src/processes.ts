import { useMemo, useSyncExternalStore } from 'react'
import type { ProcessInfo } from '../../shared/process'
import { api, subscribe } from './api'

let processes: ProcessInfo[] = []
const listeners = new Set<() => void>()

function setProcesses(next: ProcessInfo[]) {
  processes = next
  for (const listener of listeners) listener()
}

subscribe('processesChanged', setProcesses)
void api.listProcesses().then(setProcesses)

function useAllProcesses(): ProcessInfo[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => processes,
  )
}

export function useProcesses(projectId: string): ProcessInfo[] {
  const all = useAllProcesses()
  return useMemo(() => all.filter((p) => p.projectId === projectId), [all, projectId])
}

export function useProcess(processId: string): ProcessInfo | undefined {
  return useAllProcesses().find((p) => p.id === processId)
}
