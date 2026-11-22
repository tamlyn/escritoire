#!/usr/bin/env node
// A scripted `codex app-server`, so tests can drive whole agent turns without a
// model. The first word of a message picks what the turn does:
//   permission  asks to run a command, then reports the decision
//   question    asks a question, then reports the answer
//   hold        keeps working until the test releases it or the user interrupts
//   fail        ends the turn with an error
// Anything else is answered straight away. Threads are kept in FAKE_CODEX_DIR, as
// Codex keeps its rollouts, and every request is logged there for tests to read.
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const dir = process.env.FAKE_CODEX_DIR
const threadsDir = join(dir, 'threads')
mkdirSync(threadsDir, { recursive: true })

const threadPath = (id) => join(threadsDir, `${id}.json`)
const loadThread = (id) => JSON.parse(readFileSync(threadPath(id), 'utf8'))
const saveThread = (thread) => writeFileSync(threadPath(thread.id), JSON.stringify(thread))

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const notify = (method, threadId, params) => send({ method, params: { threadId, ...params } })

const threadResponse = (id, params) => ({
  thread: { id },
  model: params.model ?? 'fake-model',
  approvalPolicy: params.approvalPolicy ?? 'on-request',
  sandbox: { type: ({ 'danger-full-access': 'dangerFullAccess', 'workspace-write': 'workspaceWrite' })[params.sandbox] ?? 'readOnly', networkAccess: false },
  reasoningEffort: null,
})

let nextRequestId = 1000
const answers = new Map()
function ask(method, params) {
  const id = nextRequestId++
  send({ id, method, params })
  return new Promise((resolve) => answers.set(id, resolve))
}

const running = new Map()

function finish(turn, status, error) {
  if (turn.finished) return
  turn.finished = true
  running.delete(turn.threadId)
  const thread = loadThread(turn.threadId)
  thread.turns.push({ id: turn.id, status, items: turn.items })
  thread.updatedAt = Math.floor(Date.now() / 1000)
  saveThread(thread)
  notify('turn/completed', turn.threadId, { turn: { id: turn.id, status, ...(error ? { error: { message: error } } : {}) } })
}

function complete(turn, item) {
  turn.items.push(item)
  notify('item/completed', turn.threadId, { item })
}

function reply(turn, text) {
  const id = randomUUID()
  notify('item/started', turn.threadId, { item: { type: 'agentMessage', id, text: '' } })
  const middle = Math.ceil(text.length / 2)
  for (const delta of [text.slice(0, middle), text.slice(middle)]) {
    notify('item/agentMessage/delta', turn.threadId, { itemId: id, delta })
  }
  complete(turn, { type: 'agentMessage', id, text })
}

async function untilReleased(turn) {
  const release = join(dir, 'release')
  while (!turn.finished && !existsSync(release)) await new Promise((resolve) => setTimeout(resolve, 20))
  if (!turn.finished) rmSync(release)
}

async function play(turn, text) {
  const script = text.split(/\s+/)[0]
  if (script === 'fail') return finish(turn, 'failed', 'The model is unavailable')
  if (script === 'hold') await untilReleased(turn)
  if (script === 'permission') {
    const id = randomUUID()
    const item = { type: 'commandExecution', id, command: 'rm -rf build', status: 'inProgress', aggregatedOutput: '' }
    notify('item/started', turn.threadId, { item })
    const { decision } = await ask('item/commandExecution/requestApproval', {
      threadId: turn.threadId, itemId: id, reason: 'Delete the build directory?',
    })
    if (turn.finished) return
    complete(turn, { ...item, status: decision === 'decline' ? 'declined' : 'completed' })
    reply(turn, `Decision: ${decision}`)
  } else if (script === 'question') {
    const result = await ask('item/tool/requestUserInput', {
      threadId: turn.threadId,
      questions: [{ id: 'colour', header: 'Colour', question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] }],
    })
    if (turn.finished) return
    reply(turn, `Answer: ${result.answers.colour.answers[0]}`)
  } else if (!turn.finished) {
    reply(turn, `Reply to: ${text}`)
  }
  finish(turn, 'completed')
}

function startTurn(params) {
  const text = params.input.find((input) => input.type === 'text')?.text ?? ''
  const thread = loadThread(params.threadId)
  thread.preview ||= text
  saveThread(thread)
  const turn = { id: randomUUID(), threadId: params.threadId, items: [], finished: false }
  running.set(turn.threadId, turn)
  // After the response, as Codex answers turn/start before the turn's events.
  setImmediate(() => {
    notify('turn/started', turn.threadId, { turn: { id: turn.id } })
    complete(turn, { type: 'userMessage', id: randomUUID(), content: [{ type: 'text', text }] })
    void play(turn, text)
  })
  return { turn: { id: turn.id } }
}

function handle(method, params) {
  switch (method) {
    case 'thread/start': {
      const id = randomUUID()
      saveThread({ id, preview: '', updatedAt: Math.floor(Date.now() / 1000), turns: [] })
      return threadResponse(id, params)
    }
    case 'thread/resume':
      if (!existsSync(threadPath(params.threadId))) throw new Error(`no rollout found for ${params.threadId}`)
      return threadResponse(params.threadId, params)
    case 'thread/fork': {
      const source = loadThread(params.threadId)
      const id = randomUUID()
      const turns = source.turns.slice(0, source.turns.findIndex((turn) => turn.id === params.lastTurnId) + 1)
      saveThread({ id, preview: source.preview, updatedAt: Math.floor(Date.now() / 1000), turns })
      return threadResponse(id, params)
    }
    case 'thread/list':
      return {
        data: readdirSync(threadsDir).map((file) => {
          const { id, preview, updatedAt } = JSON.parse(readFileSync(join(threadsDir, file), 'utf8'))
          return { id, name: null, preview, updatedAt }
        }),
        nextCursor: null,
      }
    case 'thread/turns/list':
      return { data: loadThread(params.threadId).turns, nextCursor: null }
    case 'model/list':
      return {
        data: [
          {
            model: 'fake-model',
            displayName: 'Fake model',
            isDefault: true,
            supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({ reasoningEffort, description: '' })),
            defaultReasoningEffort: 'medium',
          },
          { model: 'other-model', displayName: 'Other model', supportedReasoningEfforts: [] },
        ],
        nextCursor: null,
      }
    case 'skills/list':
      return { data: [] }
    case 'account/rateLimits/read':
      throw new Error('Not signed in to a plan')
    case 'turn/start':
      return startTurn(params)
    case 'turn/interrupt': {
      const turn = running.get(params.threadId)
      if (turn) setImmediate(() => finish(turn, 'interrupted'))
      return {}
    }
    default:
      return {}
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (!message.method) {
    answers.get(message.id)?.(message.result)
    answers.delete(message.id)
    return
  }
  appendFileSync(join(dir, 'requests.jsonl'), `${JSON.stringify({ method: message.method, params: message.params })}\n`)
  if (message.id === undefined) return
  try {
    send({ id: message.id, result: handle(message.method, message.params ?? {}) })
  } catch (error) {
    send({ id: message.id, error: { code: -32000, message: error.message } })
  }
})
