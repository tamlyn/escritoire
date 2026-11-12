import { describe, expect, it } from 'vitest'
import { applyEvent, emptySessionView } from '../../shared/agent'
import { ClaudeTranscript } from './claude'

const cwd = '/work/project'

function fold(messages: object[]) {
  const transcript = new ClaudeTranscript(cwd)
  return messages
    .flatMap((m) => transcript.map(m as never))
    .reduce(applyEvent, emptySessionView).items
}

const stream = (event: object) => ({ type: 'stream_event', event, parent_tool_use_id: null })
const assistant = (id: string, content: object[]) => ({
  type: 'assistant',
  uuid: `${id}-uuid`,
  message: { id, content },
  parent_tool_use_id: null,
})

describe('ClaudeTranscript', () => {
  it('streams text into the item the final message then replaces', () => {
    const items = fold([
      stream({ type: 'message_start', message: { id: 'msg_1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    ])
    expect(items).toEqual([{ kind: 'agentMessage', id: 'msg_1#0', text: 'Hello' }])

    const final = fold([
      stream({ type: 'message_start', message: { id: 'msg_1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      assistant('msg_1', [{ type: 'text', text: 'Hello.' }]),
    ])
    expect(final).toEqual([{ kind: 'agentMessage', id: 'msg_1#0', text: 'Hello.' }])
  })

  it('numbers blocks of one API message delivered as separate messages', () => {
    const items = fold([
      assistant('msg_1', [{ type: 'thinking', thinking: 'Hmm' }]),
      assistant('msg_1', [{ type: 'text', text: 'Done' }]),
    ])
    expect(items.map((i) => i.id)).toEqual(['msg_1#0', 'msg_1#1'])
  })

  it('completes a tool call from its result', () => {
    const items = fold([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'List files' }, parent_tool_use_id: null },
      assistant('msg_1', [
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -a', description: 'List files' } },
      ]),
      {
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '.\n..' }] },
        parent_tool_use_id: null,
      },
    ])
    expect(items).toEqual([
      { kind: 'userMessage', id: 'u1', text: 'List files' },
      {
        kind: 'toolCall',
        id: 'toolu_1',
        status: 'completed',
        title: 'Bash: List files',
        view: { type: 'command', command: 'ls -a', output: '.\n..' },
      },
    ])
  })

  it('shows edits as file changes relative to the project', () => {
    const [item] = fold([
      assistant('msg_1', [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Edit',
          input: { file_path: `${cwd}/src/a.ts`, old_string: 'a\nb', new_string: 'c' },
        },
      ]),
    ])
    expect(item).toMatchObject({
      title: 'Edit: src/a.ts',
      view: { type: 'fileChange', changes: [{ path: 'src/a.ts', diff: '-a\n-b\n+c\n' }] },
    })
  })

  it('shows an interruption as a notice rather than a user message', () => {
    const items = fold([
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] },
        parent_tool_use_id: null,
      },
    ])
    expect(items).toEqual([{ kind: 'notice', id: 'u1', level: 'info', text: 'Interrupted' }])
  })

  it('keeps unrecognised blocks visible', () => {
    const [item] = fold([assistant('msg_1', [{ type: 'hologram', data: 1 }])])
    expect(item).toMatchObject({ kind: 'unknown', label: 'hologram' })
  })
})
