# Agent abstraction

How the IDE models agent sessions independently of Claude or Codex. The types live in [`src/shared/agent.ts`](../src/shared/agent.ts) and the adapter interface in [`src/main/agents/types.ts`](../src/main/agents/types.ts); this document records the shape and the reasons. Built in slice 2 against `@anthropic-ai/claude-agent-sdk` 0.3.322, and checked against the Codex event model from the spike ([codex-app-server.md](codex-app-server.md)).

## Shape

A session is a **transcript of items**, a list of **pending requests** and a **status**. Adapters in the main process turn each agent's stream into a few **events** that upsert items by id. `applyEvent` is the single reducer; main and renderer both run it, so the renderer receives a snapshot once and then only events. History loads through the same mapper as live output, so a restored session and a live one render identically.

## Process boundaries

- **Adapters run in the main process.** Each agent already runs in its own child process (the SDK spawns Claude Code; Codex is `codex app-server`), so an agent crash is a child exit, which the adapter reports as an `errored` status. A `utilityProcess` would add a second IPC hop for little gain; revisit only if main shows jank.
- **Main owns sessions.** `SessionManager` holds every loaded session across all projects, applies events, derives attention and persists the session store. It is plain Node, tested with a fake adapter.
- **The renderer only views.** It subscribes to the sessions whose tabs are mounted, which means the active project's.

## Model rules

- **Tool calls are generic with a view.** The adapter chooses the view: Claude's `Bash` and Codex's `commandExecution` become `command`; Claude's `Edit`/`Write` and Codex's `fileChange` become `fileChange`; everything else, including MCP tools, is `generic`. Add views when a generic rendering is missed.
- **Nothing disappears.** Content blocks an adapter doesn't recognise become `unknown` items showing the raw payload. (The SDK's many telemetry messages, such as rate-limit events, are ignored rather than shown.)
- **`parentId`** nests subagent work under the tool call that started it.
- **Permission options come from the adapter**, because the agents offer different choices (Codex has `acceptForSession`; Claude has permission-update suggestions). The UI renders whatever it is given.
- **Waiting for input is derived, not a status.** A session is waiting whenever it has pending requests; the adapter only reports `idle`, `working` or `errored`. A turn ends when status leaves `working`.
- **Agent-specific extras** (plan mode, Codex plan items) become new item kinds or views when built, never a widening of the shared ones.

## Claude adapter

- One long-lived `query()` per session with an `AsyncIterable` prompt; `send` feeds it, and messages sent during a turn queue. The run is started by the first message, not by opening the tab. Claude Code may pick a queued message up after the current turn's result, so any activity after a result sets `working` again.
- Behaves like ordinary Claude Code: the `claude_code` system prompt preset and all settings sources, so the user's permission mode, hooks and MCP servers apply.
- **Item ids.** The SDK delivers each content block of an API message as its own message, in order, so a block's id is the API message id plus its position. Streamed deltas carry the same position as their block index, so the final message replaces the streamed item. Verified live.
- **History** comes from `getSessionMessages`, which has the same message shapes but no structured tool results, so tool views are built from the `tool_use` input and the text result, which both paths have. Verified live: history, live output and resume agree.
- **Questions.** `AskUserQuestion` arrives through `canUseTool` and is answered with `allow` and `updatedInput.answers`. Verified live.
- **IDE tools.** Every run gets the IDE's MCP server for its project (`StartOptions.ide`) as `escritoire`, loaded up front rather than behind tool search, with the read-only tools always allowed. A `PreToolUse` hook refuses Bash calls with `run_in_background` and names the supervisor's tools instead. Verified live: Claude reaches for `start_process` unprompted, and when told to use background Bash it follows the refusal to the supervisor.
- **Interruption.** Claude Code records an interruption as a `[Request interrupted by user…]` user message, live and in history; the adapter shows it as a notice.

## Sessions in main

- **Identity is the agent's.** Claude's `query()` accepts a `sessionId`, so the IDE generates it when the tab is created; Codex's `thread/start` returns `thread.id` immediately. Everything is keyed by `(agent, agentSessionId)`. Each run asks Claude Code for the transcript first and resumes only if there is one, since a first run can fail before writing it; otherwise it starts with `sessionId`.
- **A small session store, not a transcript store.** `sessions/<projectId>.json` holds what the agents can't give back: title, draft, `lastSeenAt` and `lastTurnEndedAt`. A session tab's layout data is just the pointer. Per-session settings (model, permission mode) join the store when the UI can change them.
- **Titles.** A new session takes its first message's first line. A session started elsewhere keeps the title its agent gave it.
- **Past sessions** are the agent's own list for the project, including sessions started outside the IDE.
- **Lifecycle.** Opening a session tab loads history. Closing the tab or project stops the run; the session stays in the agent's list for resuming. A run that fails or whose Claude Code process exits denies its pending requests, sets `errored` and ends itself; the next message starts a fresh run. A closed run emits nothing. Session tabs have the id `session:<agentSessionId>`, so opening one that is already open selects it.
- **Attention** is derived in main, so it works for background projects: `waiting` if a request is pending, `unread` if a turn ended after the session was last seen, which survives restarts. The renderer reports when a session is visible (tab shown and window focused), which marks it seen.

## Main → renderer events

`Events` in [`src/shared/api.ts`](../src/shared/api.ts) is typed like `Api`, one channel per event; the preload exposes `window.subscribe(name, listener)`.

- **`sessionsChanged`**: summaries (pointer, project, title, status, attention) of every loaded session, sent when status, requests or read state change. Drives tab indicators, and later the project attention count and switcher.
- **`sessionEvent`**: `{ agentSessionId, seq, event }`, only for sessions the renderer has open.

`openSession` returns the view with its `seq` and subscribes; events at or below that `seq` are dropped, and events that arrive before the snapshot are held, which removes any race between the invoke reply and pushed events. Text deltas are not batched; coalesce in main only if streaming proves costly.

## Not built yet

- Model and permission mode switching, slash commands, @-mentions, images.
- The permission prompt has not been exercised live: the user's `auto` permission mode approved every tool in testing.

## Rejected alternatives

- **ACP as the internal model.** Close to this design and a useful reference, but it is a wire protocol whose JSON-RPC session plumbing isn't needed in-process, and neither adapter speaks it natively.
- **Sending whole transcripts to the renderer on each change.** Simple, but quadratic while streaming long sessions.
- **Storing transcripts ourselves.** Both agents persist history and list sessions, including those started elsewhere; a copy would drift.
- **An id of our own.** Unnecessary once both agents hand out their id before the first message, and it would need mapping both ways.
