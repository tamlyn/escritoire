import { expect, it } from 'vitest'
import type { PastSession, SessionSummary } from '../../../shared/agent'
import { listSessions, maxPastSessions } from './session-list'

const summary = (agentSessionId: string, projectId = 'p'): SessionSummary =>
  ({ agent: 'claude', agentSessionId, projectId, title: agentSessionId, status: 'idle', attention: null })
const past = (agentSessionId: string): PastSession =>
  ({ agent: 'claude', agentSessionId, title: agentSessionId, lastActiveAt: 0 })

it("lists only this project's loaded sessions", () => {
  const { loaded } = listSessions('p', [summary('a'), summary('b', 'other')], [])
  expect(loaded.map((s) => s.agentSessionId)).toEqual(['a'])
})

it('leaves loaded sessions out of the past sessions', () => {
  const { past: listed } = listSessions('p', [summary('a')], [past('a'), past('b')])
  expect(listed.map((s) => s.agentSessionId)).toEqual(['b'])
})

it('limits the past sessions after removing loaded ones', () => {
  const sessions = Array.from({ length: maxPastSessions + 1 }, (_, index) => past(String(index)))
  const { past: listed } = listSessions('p', [summary('0')], sessions)
  expect(listed).toHaveLength(maxPastSessions)
  expect(listed[0]!.agentSessionId).toBe('1')
})
