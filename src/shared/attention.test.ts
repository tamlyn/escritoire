import { describe, expect, it } from 'vitest'
import type { Attention, SessionSummary } from './agent'
import { needingAttention, newlyNeedingAttention } from './attention'

function summary(id: string, attention: Attention): SessionSummary {
  return { agent: 'claude', agentSessionId: id, projectId: 'p1', title: id, status: 'idle', attention }
}

describe('needingAttention', () => {
  it('lists waiting sessions before unread ones, otherwise in order', () => {
    const list = [summary('a', 'unread'), summary('b', null), summary('c', 'waiting'), summary('d', 'unread'), summary('e', 'waiting')]
    expect(needingAttention(list).map((s) => s.agentSessionId)).toEqual(['c', 'e', 'a', 'd'])
  })
})

describe('newlyNeedingAttention', () => {
  const ids = (before: SessionSummary[], after: SessionSummary[]) =>
    newlyNeedingAttention(before, after).map((s) => s.agentSessionId)

  it('reports a session that starts waiting, from nothing or from unread', () => {
    expect(ids([summary('a', null), summary('b', 'unread')], [summary('a', 'waiting'), summary('b', 'waiting')])).toEqual(['a', 'b'])
  })

  it('reports a session that becomes unread having needed nothing', () => {
    expect(ids([summary('a', null)], [summary('a', 'unread')])).toEqual(['a'])
  })

  it('ignores a waiting session whose turn ends unread', () => {
    expect(ids([summary('a', 'waiting')], [summary('a', 'unread')])).toEqual([])
  })

  it('ignores sessions whose attention is unchanged', () => {
    expect(ids([summary('a', 'waiting'), summary('b', 'unread')], [summary('a', 'waiting'), summary('b', 'unread')])).toEqual([])
  })

  it('ignores a session that has just loaded', () => {
    expect(ids([], [summary('a', 'unread'), summary('b', 'waiting')])).toEqual([])
  })
})
