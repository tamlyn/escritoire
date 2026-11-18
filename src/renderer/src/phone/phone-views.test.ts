import { expect, it } from 'vitest'
import { maxPastSessions, type PastSession, type SessionSummary } from '../../../shared/agent'
import { listSessions, terminalsIn, withCtrl } from './phone-views'

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

it('titles a resumed session from its history until it has a title of its own', () => {
  const untitled = { ...summary('a'), title: '' }
  const { loaded } = listSessions('p', [untitled], [past('a')])
  expect(loaded[0]!.title).toBe('a')
})

it('limits the past sessions after removing loaded ones', () => {
  const sessions = Array.from({ length: maxPastSessions + 1 }, (_, index) => past(String(index)))
  const { past: listed } = listSessions('p', [summary('0')], sessions)
  expect(listed).toHaveLength(maxPastSessions)
  expect(listed[0]!.agentSessionId).toBe('1')
})

it("finds the terminals in the desktop's layout", () => {
  const tab = (id: string, kind: string) => ({ id, title: id, data: { kind } })
  const layout = {
    version: 1,
    root: {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      children: [
        { type: 'tabset', id: 'left', tabs: [tab('t1', 'terminal'), tab('f1', 'file')], selectedId: 't1' },
        { type: 'tabset', id: 'right', tabs: [tab('t2', 'terminal')], selectedId: 't2' },
      ],
    },
  }
  expect(terminalsIn(layout).map((t) => t.id)).toEqual(['t1', 't2'])
  expect(terminalsIn(null)).toEqual([])
})

it('turns a letter into its control character, leaving other input alone', () => {
  expect(withCtrl('c')).toBe('\x03')
  expect(withCtrl('C')).toBe('\x03')
  expect(withCtrl('\\')).toBe('\x1c')
  expect(withCtrl(' ')).toBe('\0')
  expect(withCtrl('\x1b[A')).toBe('\x1b[A')
})
