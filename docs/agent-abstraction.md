# Agent abstraction

How the IDE models agent sessions independently of Claude or Codex. The types live in [`src/shared/agent.ts`](../src/shared/agent.ts) and the adapter interface in [`src/main/agents/types.ts`](../src/main/agents/types.ts); this document records the shape and the reasons. Built in slice 2 against `@anthropic-ai/claude-agent-sdk` 0.3.322, and checked against the Codex event model from the spike ([codex-app-server.md](codex-app-server.md)).

## Shape

A session is a **transcript of items**, a list of **pending requests** and a **status**. Adapters in the main process turn each agent's stream into a few **events** that upsert items by id. `applyEvent` is the single reducer; main and renderer both run it, so the renderer receives a snapshot once and then only events. History loads through the same mapper as live output, so a restored session and a live one render identically.

## Process boundaries

- **Adapters run in the main process.** Each agent already runs in its own child process (the SDK spawns Claude Code; Codex is `codex app-server`), so an agent crash is a child exit, which the adapter reports as an `errored` status. A `utilityProcess` would add a second IPC hop for little gain; revisit only if main shows jank.
- **Main owns sessions.** `SessionManager` holds every loaded session across all projects, applies events, derives attention and persists the session store. It is plain Node, tested with a fake adapter.
- **The renderer only views.** It subscribes to the sessions whose tabs are mounted, which means its active project's. Each client (the desktop window, later a phone) subscribes separately; main combines them (`src/main/clients.ts`).

## Model rules

- **Tool calls are generic with a view.** The adapter chooses the view: Claude's `Bash` and Codex's `commandExecution` become `command`; Claude's `Edit`/`Write` and Codex's `fileChange` become `fileChange`; everything else, including MCP tools, is `generic`. Add views when a generic rendering is missed.
- **Nothing disappears.** Content blocks an adapter doesn't recognise become `unknown` items showing the raw payload. (The SDK's many telemetry messages, such as rate-limit events, are ignored rather than shown.)
- **`parentId`** nests subagent work under the tool call that started it.
- **Permission options come from the adapter**, because the agents offer different choices (Codex has `acceptForSession`; Claude has permission-update suggestions). The UI renders whatever it is given.
- **Waiting for input is derived, not a status.** A session is waiting whenever it has pending requests; the adapter only reports `idle`, `working` or `errored`. A turn ends when status leaves `working`.
- **Agent-specific extras** (plan mode, Codex plan items) become new item kinds or views when built, never a widening of the shared ones.

## Claude adapter

- One long-lived `query()` per session with an `AsyncIterable` prompt; `send` feeds it. The run is started by the first message, not by opening the tab. Claude Code may pick a queued message up after the current turn's result, so any activity after a result sets `working` again.
- Behaves like ordinary Claude Code: the `claude_code` system prompt preset and all settings sources, so the user's permission mode, hooks and MCP servers apply.
- **Item ids.** The SDK delivers each content block of an API message as its own message, in order, so a block's id is the API message id plus its position. Streamed deltas carry the same position as their block index, so the final message replaces the streamed item. Verified live.
- **History** comes from `getSessionMessages`, which has the same message shapes but no structured tool results, so tool views are built from the `tool_use` input and the text result, which both paths have. Verified live: history, live output and resume agree.
- **Questions.** `AskUserQuestion` arrives through `canUseTool` and is answered with `allow` and `updatedInput.answers`. Verified live.
- **IDE tools.** Every run gets the IDE's MCP server for its project (`StartOptions.ide`) as `escritoire`, loaded up front rather than behind tool search, with the read-only tools always allowed. A `PreToolUse` hook refuses Bash calls with `run_in_background` and names the supervisor's tools instead. Verified live: Claude reaches for `start_process` unprompted, and when told to use background Bash it follows the refusal to the supervisor.
- **Slash commands** are listed by a probe process (`supportedCommands`) and sent as ordinary prompts, which Claude Code runs. Live, a local command's output arrives as a synthetic reply; in history the command is a `<command-name>` user message and its output a `<local-command-stdout>` one, which the adapter shows as the command typed and a notice. Verified live with `/context` and `/model`.
- **Conversation reset.** `/clear`, and leaving plan mode with cleared context, make Claude Code continue the same process as a new session with a new id (`conversation_reset`). The adapter emits `conversationReset`; `SessionManager` re-keys the session under the new id with a fresh record, so a later run resumes the new transcript rather than the old one, and the old record stays for resuming. The renderer's tab replaces itself with one for the new id. Verified live.
- **Interruption.** Claude Code records an interruption as a `[Request interrupted by user…]` user message, live and in history; the adapter shows it as a notice.

## Sessions in main

- **Identity is the agent's.** Claude's `query()` accepts a `sessionId`, so the IDE generates it when the tab is created; Codex's `thread/start` returns `thread.id` immediately. Everything is keyed by `(agent, agentSessionId)`, and a run that resets its conversation moves the session to the agent's new id. Each run asks Claude Code for the transcript first and resumes only if there is one, since a first run can fail before writing it; otherwise it starts with `sessionId`.
- **A small session store, not a transcript store.** `sessions/<projectId>.json` holds what the agents can't give back: title, draft, `lastSeenAt` and `lastTurnEndedAt`. A session tab's layout data is just the pointer. Per-session settings (model, permission mode) join the store when the UI can change them.
- **Titles.** A new session takes its first message's first line until the agent names it with `titleChanged`, which the session manager keeps in the store rather than the view. A session started elsewhere keeps the title its agent gave it. Claude's adapter reads the title (`getSessionInfo`'s `customTitle`, which is the user's `/rename` or else Claude Code's own title) after each turn, since the stream doesn't carry it; Codex's app-server doesn't name threads.
- **Suggestions.** `suggestionChanged` offers a next prompt, which the view drops when a turn starts. Claude's comes from the SDK's `promptSuggestions`, after the result; Codex has none.
- **Past sessions** are the agent's own list for the project, including sessions started outside the IDE.
- **Lifecycle.** Opening a session tab loads history. Closing the tab or project stops the run; the session stays in the agent's list for resuming. A run that fails or whose Claude Code process exits denies its pending requests, sets `errored` and ends itself; the next message starts a fresh run. A closed run emits nothing. Session tabs have the id `session:<agentSessionId>`, so opening one that is already open selects it.
- **Queued messages.** A message sent during a turn waits in the session's `queued` list, which `SessionManager` owns and reports with `queueChanged`, until status leaves `working`; then the next one is sent. Holding the queue in the IDE rather than the agent lets the user see, edit and cancel it, the same way for both agents. Adapters still accept a message mid-turn, since an agent can start a turn of its own.
- **Attention** is derived in main, so it works for background projects: `waiting` if a request is pending, `unread` if a turn ended after the session was last seen, which survives restarts. The renderer reports when a session is visible (tab shown and window focused), which marks it seen. Closing a session's tab marks it seen too. After a restart, `restoreUnread` lists the open projects' unread sessions from the store until they load, so they aren't missing from the summaries; nothing can be waiting then, since agents resume only when sent a message.

## Main → renderer events

`Events` in [`src/shared/api.ts`](../src/shared/api.ts) is typed like `Api`; the renderer listens with `subscribe(name, listener)`.

- **`sessionsChanged`**: summaries (pointer, project, title, status, attention) of every loaded session, sent when status, requests or read state change. Drives tab indicators, the inbox, the switcher's rows and ordering, and the desktop's badge and notifications (`shared/attention.ts` says which sessions need the user, and which have just started to).
- **`focusSession`**: `{ projectId, pointer, title }`, to the desktop only, when the user clicks a notification. The renderer switches project through `activateProject` and shows the session, as choosing it in the inbox does.
- **`sessionEvent`**: `{ agentSessionId, seq, event }`, only for sessions the renderer has open.

`openSession` returns the view with its `seq` and subscribes; events at or below that `seq` are dropped, and events that arrive before the snapshot are held, which removes any race between the reply and pushed events. Text deltas are not batched; coalesce in main only if streaming proves costly.

## Not built yet

- Model and permission mode switching, @-mentions, images.
- The permission prompt has not been exercised live: the user's `auto` permission mode approved every tool in testing.

## Rejected alternatives

- **ACP as the internal model.** Close to this design and a useful reference, but it is a wire protocol whose JSON-RPC session plumbing isn't needed in-process, and neither adapter speaks it natively.
- **Sending whole transcripts to the renderer on each change.** Simple, but quadratic while streaming long sessions.
- **Storing transcripts ourselves.** Both agents persist history and list sessions, including those started elsewhere; a copy would drift.
- **An id of our own.** Unnecessary once both agents hand out their id before the first message, and it would need mapping both ways.

## Codex adapter

Slice 6 adds `codex` to the same agent interface and tab UI. It uses one native
app-server connection per run; see [codex-app-server.md](codex-app-server.md) for
protocol and lifecycle details. Optional adapter `closeSession` and `dispose`
hooks release threads created before their first message. Recent-session listing
combines successful adapters, so an absent Codex binary does not hide Claude's
history.

Slash commands are the adapter's: `/clear` starts a new thread on the run's
connection, in the same mode, and reports it as `conversationReset`; `/compact` calls `thread/compact/start`, whose
turn is announced only by `turn/started` (verified live); `/review` calls
`review/start` on uncommitted changes, or with the arguments as custom
instructions; any other name matching an enabled skill from `skills/list` is a
normal turn with a `skill` input beside the text. Anything else is plain text.
