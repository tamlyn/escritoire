import type { SessionSummary } from '../../shared/agent'
import type { ProcessInfo } from '../../shared/process'

export type ProjectActivity = {
  waiting: number
  unread: number
  working: number
  running: number
  failed: number
}

const none: ProjectActivity = { waiting: 0, unread: 0, working: 0, running: 0, failed: 0 }

/** What is going on in each project, by project id. A project with nothing going on is missing. */
export function projectActivity(summaries: SessionSummary[], processes: ProcessInfo[]): Map<string, ProjectActivity> {
  const activity = new Map<string, ProjectActivity>()
  const of = (projectId: string) => {
    let entry = activity.get(projectId)
    if (!entry) {
      entry = { ...none }
      activity.set(projectId, entry)
    }
    return entry
  }
  for (const session of summaries) {
    if (session.attention === 'waiting') of(session.projectId).waiting++
    else if (session.attention === 'unread') of(session.projectId).unread++
    else if (session.status === 'working') of(session.projectId).working++
  }
  for (const process of processes) {
    if (process.status === 'running') of(process.projectId).running++
    else if (process.status === 'failed') of(process.projectId).failed++
  }
  return activity
}
