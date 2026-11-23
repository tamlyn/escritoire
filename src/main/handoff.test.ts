import { describe, expect, it } from 'vitest'
import { rewarmPrompt } from './agents/types'
import { handoffPrompt } from './handoff'

const image = { mediaType: 'image/png', data: 'AA==' }

describe('handoffPrompt', () => {
  it("keeps the user's messages in order and the agent's final top-level reply", () => {
    const prompt = handoffPrompt({ agent: 'claude', agentSessionId: 'abc' }, [
      { kind: 'userMessage', id: 'u1', text: 'Fix the bug' },
      { kind: 'agentMessage', id: 'a1', text: 'Which one?' },
      { kind: 'userMessage', id: 'u2', text: 'The login one' },
      { kind: 'agentMessage', id: 'a2', text: 'Fixed the login bug.' },
      { kind: 'agentMessage', id: 'a3', parentId: 't1', text: 'Subagent findings' },
      { kind: 'toolCall', id: 't2', status: 'completed', title: 'Read', view: { kind: 'other' } } as never,
    ])

    expect(prompt).toContain('`abc.jsonl` under `~/.claude/projects/`')
    expect(prompt.indexOf('Fix the bug')).toBeLessThan(prompt.indexOf('The login one'))
    expect(prompt).toContain('<your-final-reply>\nFixed the login bug.\n</your-final-reply>')
    expect(prompt).not.toContain('Which one?')
    expect(prompt).not.toContain('Subagent findings')
    expect(prompt.endsWith('\n\n---\n\n')).toBe(true)
  })

  it('leaves out turns sent to keep the cache warm', () => {
    const prompt = handoffPrompt({ agent: 'codex', agentSessionId: 'abc' }, [
      { kind: 'userMessage', id: 'u1', text: 'Fix the bug' },
      { kind: 'agentMessage', id: 'a1', text: 'Fixed the bug.' },
      { kind: 'userMessage', id: 'u2', text: rewarmPrompt },
      { kind: 'agentMessage', id: 'a2', text: 'Ready' },
    ])

    expect(prompt).not.toContain('Rewarm')
    expect(prompt).toContain('<your-final-reply>\nFixed the bug.\n</your-final-reply>')
  })

  it('notes images that were left out', () => {
    const prompt = handoffPrompt({ agent: 'codex', agentSessionId: 'abc' }, [
      { kind: 'userMessage', id: 'u1', text: '', images: [image, image] },
      { kind: 'userMessage', id: 'u2', text: 'Like this', images: [image] },
    ])

    expect(prompt).toContain('<my-message>\n(2 images I attached are not included.)\n</my-message>')
    expect(prompt).toContain('<my-message>\nLike this\n\n(An image I attached is not included.)\n</my-message>')
    expect(prompt).not.toContain('<your-final-reply>')
    expect(prompt).toContain('~/.codex/sessions/')
  })
})
