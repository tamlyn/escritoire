import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentEvent, applyEvent, emptySessionView } from '../../shared/agent'
import { ClaudeTranscript, planLimits, probe } from './claude'
import { ContextWindows } from './context-windows'

const cwd = '/work/project'

function foldView(messages: object[]) {
  const transcript = new ClaudeTranscript(cwd)
  return messages.flatMap((m) => transcript.map(m as never)).reduce(applyEvent, emptySessionView)
}

const fold = (messages: object[]) => foldView(messages).items

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

  it('shows a plan as a plan, untouched by its result', () => {
    const items = fold([
      assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'ExitPlanMode', input: { plan: '# Plan\n\n1. Do it' } }]),
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'User has approved your plan.' }] },
        parent_tool_use_id: null,
      },
    ])
    expect(items).toEqual([{ kind: 'plan', id: 'toolu_1', text: '# Plan\n\n1. Do it' }])
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

  it('shows a saved slash command as typed and its output as a notice', () => {
    const user = (uuid: string, content: string) => ({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null })
    const items = fold([
      user('u1', '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>sonnet</command-args>'),
      user('u2', '<local-command-stdout>Set model to `Sonnet 5.5`</local-command-stdout>'),
      user('u3', '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>'),
      user('u4', '<local-command-stdout></local-command-stdout>'),
      user('u5', '<command-message>daily-health</command-message>\n<command-name>/daily-health</command-name>\n<command-args>today</command-args>'),
    ])
    expect(items).toEqual([
      { kind: 'userMessage', id: 'u1', text: '/model sonnet' },
      { kind: 'notice', id: 'u2', level: 'info', text: 'Set model to `Sonnet 5.5`' },
      { kind: 'userMessage', id: 'u3', text: '/compact' },
      { kind: 'userMessage', id: 'u5', text: '/daily-health today' },
    ])
  })

  it("hides Claude Code's own prompts to the model, live and saved", () => {
    const items = fold([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Resume.' }, isSynthetic: true, parent_tool_use_id: null },
      {
        type: 'user',
        uuid: 'u2',
        session_id: 's1',
        message: { role: 'user', content: 'This session is being continued from a previous conversation…' },
        parent_tool_use_id: null,
        parent_agent_id: null,
        isCompactSummary: true,
        is_meta: true,
        timestamp: '2026-11-13T09:00:00.000Z',
      },
    ])
    expect(items).toEqual([])
  })

  it('shows a failed live request as an error that leaves the usage alone', () => {
    const view = foldView([
      {
        type: 'assistant',
        uuid: 'e1',
        error: 'authentication_failed',
        message: {
          id: 'synthetic-1',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'API Error: 403' }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        parent_tool_use_id: null,
      },
    ])
    expect(view.items).toEqual([{ kind: 'notice', id: 'e1', level: 'error', text: 'API Error: 403' }])
    expect(view.usage).toBeUndefined()
  })

  it('keeps unrecognised blocks visible', () => {
    const [item] = fold([assistant('msg_1', [{ type: 'hologram', data: 1 }])])
    expect(item).toMatchObject({ kind: 'unknown', label: 'hologram' })
  })

  it('reports context and cache use from the latest main request, sized by the result', () => {
    const usage = (cacheRead: number, ttl: '5m' | '1h' | null) => ({
      type: 'assistant',
      timestamp: '2026-11-13T09:00:00.000Z',
      parent_tool_use_id: null,
      message: {
        id: `msg_${cacheRead}`,
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'Hi' }],
        usage: {
          input_tokens: 2,
          output_tokens: 8,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: ttl ? 90 : 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: ttl === '1h' ? 90 : 0 },
        },
      },
    })
    const view = foldView([
      usage(1000, '1h'),
      usage(2000, null),
      { type: 'result', subtype: 'success', modelUsage: { 'claude-opus-5-5': { contextWindow: 1_000_000 } } },
    ])
    expect(view.usage).toEqual({
      contextTokens: 2010,
      contextWindow: 1_000_000,
      cacheReadTokens: 2000,
      cacheWriteTokens: 0,
      cacheTtlMs: 3_600_000,
      at: Date.parse('2026-11-13T09:00:00.000Z'),
    })
  })

  it('sizes the context from a window it learnt before, from a result or the breakdown', () => {
    const windows = ContextWindows.inMemory()
    const request = {
      type: 'assistant',
      timestamp: '2026-11-13T09:00:00.000Z',
      parent_tool_use_id: null,
      message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 30_000, output_tokens: 0 } },
    }
    const first = new ClaudeTranscript('/project', windows)
    first.map(request as never)
    const [event] = first.mapContextUsage({ model: 'claude-opus-5-5', rawMaxTokens: 200_000, categories: [] } as never)
    expect(event).toMatchObject({ type: 'usageChanged', usage: { contextWindow: 200_000 } })

    const later = new ClaudeTranscript('/project', windows)
    expect(later.map(request as never)).toContainEqual(expect.objectContaining({ usage: expect.objectContaining({ contextWindow: 200_000 }) }))
  })

  it('breaks the context down by what uses it, until compaction makes that stale', () => {
    const transcript = new ClaudeTranscript('/project')
    let view = emptySessionView
    const apply = (events: AgentEvent[]) => { for (const event of events) view = applyEvent(view, event) }
    apply(transcript.map({
      type: 'assistant',
      timestamp: '2026-11-13T09:00:00.000Z',
      parent_tool_use_id: null,
      message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 30_000, output_tokens: 0 } },
    } as never))
    apply(transcript.mapContextUsage({
      categories: [
        { name: 'System prompt', tokens: 5_000, kind: 'used', color: '' },
        { name: 'Messages', tokens: 25_000, kind: 'used', color: '' },
        { name: 'MCP tools (deferred)', tokens: 9_000, kind: 'deferred', color: '' },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer', color: '' },
        { name: 'Free space', tokens: 100_000, kind: 'free', color: '' },
      ],
    } as never))
    expect(view.usage?.categories).toEqual([
      { name: 'System prompt', tokens: 5_000, reserved: false },
      { name: 'Messages', tokens: 25_000, reserved: false },
      { name: 'Autocompact buffer', tokens: 33_000, reserved: true },
    ])
    apply(transcript.map({ type: 'system', subtype: 'compact_boundary', compact_metadata: { post_tokens: 12_000 } } as never))
    expect(view.usage?.categories).toBeUndefined()
  })

  it('reports the five-hour and weekly plan limits', () => {
    expect(planLimits({
      rate_limits: {
        five_hour: { utilization: 7, resets_at: '2026-11-17T18:50:00.000Z' },
        seven_day: { utilization: 22, resets_at: null },
        seven_day_opus: { utilization: 50, resets_at: null },
      },
    } as never)).toEqual([
      { label: 'Current session', usedPercent: 7, resetsAt: Date.parse('2026-11-17T18:50:00.000Z') },
      { label: 'Weekly', usedPercent: 22, resetsAt: null },
    ])
    expect(planLimits({ rate_limits: null } as never)).toEqual([])
  })

  it('shrinks the context to what compaction left', () => {
    const view = foldView([
      {
        type: 'assistant',
        timestamp: '2026-11-13T09:00:00.000Z',
        parent_tool_use_id: null,
        message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 95_000, output_tokens: 0 } },
      },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 95_000, post_tokens: 12_000 } },
    ])
    expect(view.usage?.contextTokens).toBe(12_000)
  })

  it('tracks background tasks and notes when one finishes', () => {
    const view = foldView([
      assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'Monitor', input: { command: 'make' } }]),
      {
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 't1', task_type: 'local_bash', description: 'Watch the build' },
          { task_id: 't2', task_type: 'local_bash', description: 'Housekeeping', ambient: true },
        ],
      },
      { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_1' },
      { type: 'system', subtype: 'task_notification', uuid: 'n1', task_id: 't1', summary: 'Monitor "Watch the build" stream ended' },
      { type: 'system', subtype: 'task_notification', uuid: 'n2', task_id: 'foreground', summary: 'Agent finished' },
    ])
    expect(view.tasks).toEqual([{ id: 't1', kind: 'Monitor', description: 'Watch the build' }])
    expect(view.items.slice(1)).toEqual([
      { kind: 'notice', id: 'n1', level: 'info', text: 'Monitor "Watch the build" stream ended' },
    ])
  })

  it('shows a saved task notification as a notice', () => {
    const items = fold([
      {
        type: 'user',
        uuid: 'u1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: '<task-notification>\n<task-id>t1</task-id>\n<summary>Monitor event: "Build"</summary>\n<event>failed</event>\n</task-notification>',
        },
      },
    ])
    expect(items).toEqual([{ kind: 'notice', id: 'u1', level: 'info', text: 'Monitor event: "Build": failed' }])
  })

  it('keeps images in user messages', () => {
    const items = fold([
      {
        type: 'user',
        uuid: 'u1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'text', text: 'What is this?' },
          ],
        },
      },
    ])
    expect(items).toEqual([
      { kind: 'userMessage', id: 'u1', text: 'What is this?', images: [{ mediaType: 'image/png', data: 'AAAA' }] },
    ])
  })

  it('reports the model and permission mode Claude Code is using', () => {
    const view = foldView([
      { type: 'system', subtype: 'init', model: 'claude-opus-5-5', permissionMode: 'auto' },
      { type: 'system', subtype: 'status', status: null, permissionMode: 'plan' },
    ])
    expect(view.settings).toEqual({ model: 'claude-opus-5-5', permissionMode: 'plan' })
  })

  it('offers the suggested next prompt until the next turn starts', () => {
    const suggestion = { type: 'prompt_suggestion', suggestion: 'Run the tests', uuid: 's1', session_id: 'x' }
    expect(foldView([suggestion]).suggestion).toBe('Run the tests')
    const next = applyEvent(foldView([suggestion]), { type: 'statusChanged', status: 'working' })
    expect(next.suggestion).toBeUndefined()
  })
})

describe('probe', () => {
  afterEach(() => { delete process.env.ESCRITOIRE_CLAUDE_CODE_PATH })

  it('gives up on a Claude Code that never answers, and stops it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'escritoire-claude-'))
    const pidFile = join(dir, 'pid')
    const path = join(dir, 'claude.mjs')
    await writeFile(path, `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
process.stdin.resume()
`)
    process.env.ESCRITOIRE_CLAUDE_CODE_PATH = path

    await expect(probe(dir, (query) => query.supportedModels(), 500)).rejects.toThrow("Claude Code didn't answer")
    const pid = Number(await readFile(pidFile, 'utf8'))
    await expect.poll(() => isRunning(pid)).toBe(false)
  })
})

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
