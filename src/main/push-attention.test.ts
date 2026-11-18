import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attention, SessionSummary } from '../shared/agent'
import { PushAttention, type PushTarget } from './push-attention'

const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }
const phone: PushTarget = { deviceId: 'phone', subscription }

const summary = (attention: Attention): SessionSummary =>
  ({ agent: 'claude', agentSessionId: 's1', projectId: 'p', title: 'Fix it', status: 'idle', attention })

let targets: PushTarget[]
let desktopPresent: boolean
let shownOn: string[]
const send = vi.fn(async () => {})

function becomeWaiting(): void {
  const attention = new PushAttention({
    targets: () => targets,
    desktopPresent: () => desktopPresent,
    deviceShows: (deviceId) => shownOn.includes(deviceId),
    projectName: () => 'Project',
    send,
  })
  attention.update([summary(null)])
  attention.update([summary('waiting')])
}

beforeEach(() => {
  targets = [phone]
  desktopPresent = false
  shownOn = []
  send.mockClear()
})

describe('pushes a session that needs the user', () => {
  it('to a subscribed device while the user is away from the desktop', () => {
    becomeWaiting()
    expect(send).toHaveBeenCalledExactlyOnceWith(phone, {
      title: 'Project',
      body: 'Fix it needs your input',
      session: { projectId: 'p', pointer: { agent: 'claude', agentSessionId: 's1' }, title: 'Fix it' },
    })
  })

  it('not while the user is at the desktop', () => {
    desktopPresent = true
    becomeWaiting()
    expect(send).not.toHaveBeenCalled()
  })

  it('not with no subscribed devices, as while remote access is off', () => {
    targets = []
    becomeWaiting()
    expect(send).not.toHaveBeenCalled()
  })

  it('not to a device already showing the session, but to the others', () => {
    const tablet = { ...phone, deviceId: 'tablet' }
    targets = [phone, tablet]
    shownOn = ['phone']
    becomeWaiting()
    expect(send).toHaveBeenCalledExactlyOnceWith(tablet, expect.anything())
  })
})

describe('holds what comes up while the user is at the desktop', () => {
  function attentionWhilePresent() {
    desktopPresent = true
    const attention = new PushAttention({
      targets: () => targets,
      desktopPresent: () => desktopPresent,
      deviceShows: () => false,
      projectName: () => 'Project',
      send,
    })
    attention.update([summary(null)])
    attention.update([summary('waiting')])
    return attention
  }

  it('and pushes it once they leave', () => {
    const attention = attentionWhilePresent()
    desktopPresent = false
    attention.desktopLeft()
    expect(send).toHaveBeenCalledOnce()

    attention.desktopLeft()
    expect(send).toHaveBeenCalledOnce()
  })

  it('unless they dealt with it first', () => {
    const attention = attentionWhilePresent()
    attention.update([summary(null)])
    desktopPresent = false
    attention.desktopLeft()
    expect(send).not.toHaveBeenCalled()
  })
})

it('pushes nothing for a session that has only just loaded', () => {
  const attention = new PushAttention({
    targets: () => targets,
    desktopPresent: () => false,
    deviceShows: () => false,
    projectName: () => 'Project',
    send,
  })
  attention.update([summary('waiting')])
  expect(send).not.toHaveBeenCalled()
})
