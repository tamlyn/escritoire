# Agent abstraction: proposal

Status: proposal for slice 2. Checked against `@anthropic-ai/claude-agent-sdk` 0.3.322 and the Codex spike ([codex-app-server.md](codex-app-server.md)).

## Shape in one paragraph

A session is a **transcript of items**, a set of **pending requests** and a **status**. Adapters in the main process turn each agent's stream into a small set of **events** that upsert items by id. A pure reducer applies those events; main and renderer run the same reducer, so the renderer receives a snapshot once and then only events. History loads through the same item mapper as live output, so a restored session and a live one render identically.

## Process boundaries

- **Adapters run in the main process.** Both agents already run in their own child process (the SDK spawns Claude Code; Codex is `codex app-server`), so an agent crash is a child exit, which the adapter turns into an `errored` status. Moving adapters into a `utilityProcess` would add a second IPC hop for little gain; revisit only if main shows jank.
- **Main owns sessions.** A `SessionManager` holds every live session across all projects, applies events, derives attention state and persists the session store. It is plain Node and unit-testable with a fake adapter.
- **The renderer only views.** It subscribes to the sessions whose tabs are mounted, which in practice means the active project's.

## Core types (`src/shared/agent.ts`)

```ts
type AgentKind = 'claude' | 'codex'

type Item =
  | { kind: 'userMessage'; id: string; text: string }
  | { kind: 'agentMessage'; id: string; text: string } // Markdown
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'toolCall'; id: string; parentId?: string; status: ToolStatus; title: string; view: ToolView }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string } // compaction, retries, API errors
  | { kind: 'unknown'; id: string; label: string; raw: unknown }

type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'declined'

type ToolView =
  | { type: 'command'; command: string; cwd?: string; output: string; exitCode?: number }
  | { type: 'fileChange'; changes: { path: string; diff: string }[] }
  | { type: 'generic'; name: string; input: unknown; output?: string }

type PendingRequest =
  | { kind: 'permission'; id: string; itemId?: string; title: string; view: ToolView; options: PermissionOption[] }
  | { kind: 'question'; id: string; questions: Question[] }

type PermissionOption = { id: string; label: string; kind: 'allowOnce' | 'allowAlways' | 'deny' }

type SessionStatus = 'idle' | 'working' | 'waiting' | 'errored'
```

Design rules:

- **Tool calls are generic with a view.** The adapter decides the view: Claude's `Bash` and Codex's `commandExecution` both become `command`; Claude's `Edit`/`Write` and Codex's `fileChange` become `fileChange`; everything else, including MCP tools, is `generic`. New views are added when a generic rendering is missed, so an unrecognised tool always shows something.
- **`unknown` items guarantee visible degradation.** An adapter that meets an event type it doesn't map emits `unknown` with the raw payload rather than dropping it.
- **`parentId`** nests subagent work under the call that started it (Claude's `parent_tool_use_id`; Codex's subagent items).
- **Permission options come from the adapter**, as in ACP, because the agents offer different choices (Codex has `acceptForSession`; Claude has permission-update suggestions). The UI renders whatever options it is given.
- **Agent-specific extras** (Claude's plan mode, Codex's plan items) are added as new item kinds or views when built, never by widening the shared ones to fit one agent.

## Events

```ts
type AgentEvent =
  | { type: 'itemUpserted'; item: Item }                       // full item, authoritative
  | { type: 'textAppended'; itemId: string; text: string }     // streaming into agentMessage, reasoning or command output
  | { type: 'requestAdded'; request: PendingRequest }
  | { type: 'requestResolved'; requestId: string }
  | { type: 'statusChanged'; status: SessionStatus; error?: string }
  | { type: 'turnEnded'; outcome: 'completed' | 'interrupted' | 'failed' }
```

Both agents fit this directly: Codex's `item/started`/`item/completed` and Claude's assistant messages and tool results are upserts; Codex's `*/delta` notifications and Claude's `stream_event` deltas are appends; Codex server requests and Claude's `canUseTool` callback are requests. `applyEvent(state, event)` is the single reducer, in shared code, used by main and renderer.

## Adapter interface (main only)

```ts
interface AgentAdapter {
  kind: AgentKind
  listSessions(cwd: string): Promise<PastSession[]>
  loadHistory(agentSessionId: string, cwd: string): Promise<Item[]>
  start(options: StartOptions, emit: (event: AgentEvent) => void): AgentRun
}

type StartOptions = { cwd: string; resume?: string; settings: SessionSettings; mcpServer: { url: string; token: string } }

interface AgentRun {
  readonly agentSessionId: Promise<string>
  send(text: string): void        // during a turn this queues (Claude) or steers (Codex)
  interrupt(): Promise<void>
  respond(requestId: string, optionId: string | QuestionAnswers): void
  updateSettings(settings: Partial<SessionSettings>): Promise<void> // model, permission mode
  close(): Promise<void>
}
```

- **Claude:** one long-lived `query()` per session with an `AsyncIterable` prompt, so `send` feeds the same query and the run lasts the session's lifetime. `interrupt`, `setModel` and `setPermissionMode` exist on `Query`. Use the `claude_code` preset and settings sources (see PLAN platform notes). `canUseTool` resolves a promise held per pending request; `AskUserQuestion` arrives there too and becomes a `question` request.
- **Codex:** one `thread/start` or `thread/resume` per session, as proven in the spike. Process sharing is decided in slice 6.

## Sessions in main

- **Identity is the agent's.** Claude's `query()` accepts a `sessionId`, so we generate the UUID when the tab is created; Codex's `thread/start` returns `thread.id` immediately. Everything is keyed by `(agent, agentSessionId)`; there is no id of our own. A Claude id with no transcript yet (tab opened, nothing sent) starts with `sessionId` rather than `resume`.
- **A small session store, not a transcript store.** `sessions/<projectId>.json` holds per session only what the agents can't give back: cached title, settings (model, permission mode; neither SDK's history API returns them reliably), draft, `lastSeenAt` and `lastTurnEndedAt`. A session tab's layout data is just the pointer `{ kind: 'session', agent, agentSessionId }`.
- **Past sessions** are the agent's own list (one `listSessions`/`thread/list` call per project, titles included) merged with the store, so a session resumed from the list gets its settings and read state back. Sessions started outside the IDE simply have no record until opened.
- **Lifecycle.** Opening a session tab loads history. The first `send` starts a run, resuming where history exists. Closing the tab or project closes the run but keeps the record. A crashed run sets `errored`; the next send starts a fresh resumed run. Opening a session already open in a tab focuses that tab.
- **Attention** is derived in main, so it works for background projects: `waiting` if any request is pending, `unread` if `lastTurnEndedAt` is after `lastSeenAt` (which survives restarts), `draft` if a draft exists, `errored` from status. The renderer calls `markSeen` while a session tab is visible, and saves drafts debounced.

## Main → renderer events

The IPC contract gains an `Events` map alongside `Api`, typed the same way. Main sends on one channel with `webContents.send`; the preload exposes `onEvent(listener)` returning an unsubscribe function.

- **`sessionsChanged`**: small summaries (id, project, title, status, attention) for all sessions, sent on any change. Drives tab indicators, the attention count and the project switcher.
- **`sessionEvent`**: `{ sessionId, seq, event }`, only for sessions the renderer has opened.

Opening a session tab calls `api.openSession(id)`, which returns `{ items, requests, status, seq }` and subscribes; unmounting calls `api.closeSessionView(id)`. Events with `seq` at or below the snapshot's are dropped, which removes any ordering race between the invoke reply and pushed events. Text appends are not batched at first; coalesce per frame in main only if streaming proves costly.

New `Api` methods: `listPastSessions`, `createSession` (returns the pointer for a new tab), `openSession`, `closeSessionView`, `sendMessage`, `interrupt`, `respond`, `updateSessionSettings`, `saveDraft`, `markSeen`, `closeSession`. Session methods take the pointer (`agent`, `agentSessionId`), not an id of ours.

## To verify early in slice 2

1. **Claude stream keys.** With `includePartialMessages`, deltas arrive per content block index, while each final `SDKAssistantMessage` carries one block and no index. Confirm that text deltas can be keyed to the item the final message upserts (likely `message.id` plus block position), otherwise drop the partial item when the final one arrives.
2. **Claude history fidelity.** `getSessionMessages` returns `SessionMessage` with an untyped Messages API `message` and no `tool_use_result`, unlike live `SDKUserMessage`. Build tool views from the `tool_use` input and text result, which both paths have, and treat structured output as an optional extra for live rendering.
3. **Answering `AskUserQuestion`** through `canUseTool` (expected: `allow` with `updatedInput` carrying the answers).
4. **Subscription terms** for the Agent SDK, already flagged in PLAN.

## Rejected alternatives

- **ACP as the internal model.** Close to this design and a useful reference, but it is a wire protocol, with JSON-RPC session plumbing we don't need in-process, and neither adapter speaks it natively.
- **Sending whole transcripts to the renderer on each change.** Simple, but quadratic while streaming long sessions.
- **Storing transcripts ourselves.** Both agents already persist history and list sessions, including those started outside the IDE; a copy would drift. The session store holds only what the agents don't.
- **An id of our own.** Unnecessary once both agents hand out their id before the first message, and it would need mapping in both directions.
