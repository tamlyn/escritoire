#!/usr/bin/env node
// A scripted Claude Code CLI, speaking the Agent SDK's stream-json protocol, so the
// screenshots show real Claude sessions without a model. A message with a turn in
// FAKE_CLAUDE_DIR/script.json plays it (see `ClaudeScript` in claude.ts); anything
// else is answered straight away. Only what the IDE asks of Claude Code is here:
// it keeps no transcript, so sessions don't resume.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const dir = process.env.FAKE_CLAUDE_DIR
const script = JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8'))
const model = 'claude-opus-5-5'

// The SDK gives options as `--name=value` or as two arguments.
const arg = (name) => {
  const joined = process.argv.find((a) => a.startsWith(`${name}=`))
  if (joined) return joined.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const sessionId = arg('--session-id') ?? arg('--resume') ?? randomUUID()
let permissionMode = arg('--permission-mode') ?? 'default'

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const respond = (requestId, response) =>
  send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })

const models = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5', resolvedModel: model, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', displayName: 'Opus 5.5', description: 'For complex work', resolvedModel: model, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet 5.5', description: 'For everyday tasks', resolvedModel: 'claude-sonnet-5-5', supportedEffortLevels: ['low', 'medium', 'high'] },
]

function control(requestId, request) {
  switch (request.subtype) {
    case 'initialize':
      return respond(requestId, { commands: [], agents: [], models, account: {}, output_style: 'default', available_output_styles: ['default'] })
    case 'set_permission_mode':
      permissionMode = request.mode
      send({ type: 'system', subtype: 'status', status: null, permissionMode, session_id: sessionId, uuid: randomUUID() })
      return respond(requestId, {})
    case 'get_context_usage':
      return respond(requestId, { model, rawMaxTokens: 1_000_000, categories: [] })
    case 'interrupt':
      turn?.interrupt()
      return respond(requestId, {})
    default:
      return respond(requestId, {})
  }
}

let turn
let initialised = false

function playTurn(text) {
  if (!initialised) {
    initialised = true
    send({ type: 'system', subtype: 'init', session_id: sessionId, uuid: randomUUID(), model, permissionMode, cwd: process.cwd(), tools: [], mcp_servers: [], slash_commands: [], apiKeySource: 'none' })
  }
  const scripted = script.turns[text] ?? { steps: [{ text: `Reply to: ${text}` }] }
  let interrupted = false
  turn = { interrupt: () => (interrupted = true) }
  const usage = { input_tokens: 6, output_tokens: 410, cache_read_input_tokens: 41200, cache_creation_input_tokens: 5700, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 5700 } }
  const assistant = (block) =>
    send({ type: 'assistant', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content: [block], usage }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() })

  for (const step of scripted.steps) {
    if (step.thinking) assistant({ type: 'thinking', thinking: step.thinking, signature: '' })
    if (step.text) assistant({ type: 'text', text: step.text })
    if (step.tool) {
      const id = `toolu_${randomUUID()}`
      // Paths are given relative to the project, as Claude Code's tools take absolute ones.
      const input = step.input.file_path ? { ...step.input, file_path: resolve(step.input.file_path) } : step.input
      assistant({ type: 'tool_use', id, name: step.tool, input })
      send({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: step.result ?? '' }] }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() })
    }
  }
  const finish = () => {
    turn = undefined
    send({
      type: 'result', subtype: interrupted ? 'error_during_execution' : 'success', is_error: interrupted, errors: [],
      result: scripted.steps.findLast((step) => step.text)?.text ?? '', session_id: sessionId, uuid: randomUUID(),
      duration_ms: 1000, duration_api_ms: 1000, num_turns: 1, total_cost_usd: 0, usage, permission_denials: [],
      modelUsage: { [model]: { contextWindow: 1_000_000 } },
    })
  }
  if (!scripted.hold) return finish()
  // Keeps working until the test writes the release file or the user interrupts.
  const release = join(dir, 'release')
  const timer = setInterval(() => {
    if (!interrupted && !existsSync(release)) return
    clearInterval(timer)
    if (existsSync(release)) rmSync(release)
    finish()
  }, 20)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type === 'control_request') return control(message.request_id, message.request)
  if (message.type !== 'user') return
  const { content } = message.message
  playTurn(typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'))
})
