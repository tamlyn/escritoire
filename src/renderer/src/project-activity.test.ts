import { describe, expect, it } from 'vitest'
import type { Attention, SessionStatus, SessionSummary } from '../../shared/agent'
import type { ProcessInfo, ProcessStatus } from '../../shared/process'
import { projectActivity } from './project-activity'

let nextId = 0

function session(projectId: string, status: SessionStatus, attention: Attention): SessionSummary {
  return { agent: 'claude', agentSessionId: `s${nextId++}`, projectId, title: '', status, attention }
}

function process(projectId: string, status: ProcessStatus): ProcessInfo {
  return {
    id: `p${nextId++}`,
    projectId,
    command: 'run',
    cwd: '',
    task: null,
    status,
    exitCode: null,
    startedAt: 0,
    endedAt: null,
    ports: [],
  }
}

describe('projectActivity', () => {
  it("counts each project's sessions and processes", () => {
    const activity = projectActivity(
      [
        session('a', 'working', 'waiting'),
        session('a', 'idle', 'unread'),
        session('a', 'working', null),
        session('a', 'idle', null),
        session('b', 'working', null),
      ],
      [process('a', 'running'), process('b', 'failed'), process('b', 'running'), process('b', 'exited')],
    )

    expect(activity.get('a')).toEqual({ waiting: 1, unread: 1, working: 1, running: 1, failed: 0 })
    expect(activity.get('b')).toEqual({ waiting: 0, unread: 0, working: 1, running: 1, failed: 1 })
  })

  it('leaves out projects with nothing going on', () => {
    const activity = projectActivity([session('a', 'idle', null)], [process('a', 'stopped')])
    expect(activity.size).toBe(0)
  })
})
