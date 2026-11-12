# Codex app-server: spike findings

Spike run on 12 November 2026 against `codex-cli 0.167.0` on macOS, using the user's existing ChatGPT login. It drove `codex app-server` over stdio from a Node script, with a token-protected HTTP MCP server standing in for the supervisor.

## Why app-server rather than ACP

`@agentclientprotocol/codex-acp` (2.6.0) is a TypeScript adapter that spawns `codex app-server` and translates between the two protocols. Reading its source showed every ACP capability it offers maps directly onto app-server: ACP `mcpServers` become `thread/start`'s `config.mcp_servers`, and `session/load`, `session/resume` and `session/list` map onto the `thread/*` methods. ACP would add a translation layer, its own pinned `@openai/codex` dependency (`^0.166.0`, older than the installed CLI) and some non-standard extensions, with nothing gained. OpenAI positions app-server as the interface for rich clients like its VS Code extension.

## What was verified

| Need | Result |
|---|---|
| Authentication | Reuses `~/.codex` login with no client involvement (`initialize` reports `codexHome`). |
| Per-session MCP | `thread/start` with `config: { mcp_servers: { escritoire: { url, http_headers: { Authorization } } } }`. Codex connected with the bearer token and called the tool. Nothing in `~/.codex/config.toml` was needed. |
| Approvals | Server-to-client JSON-RPC requests; the turn waits for the answer. Commands: `item/commandExecution/requestApproval` → `{ decision: "accept" \| "acceptForSession" \| "decline" \| "cancel" \| … }`. File edits: `item/fileChange/requestApproval` → same decisions. MCP tool calls: `mcpServer/elicitation/request` with `_meta.codex_approval_kind: "mcp_tool_call"` → `{ action: "accept", content: {} }`. |
| Interrupt | `turn/interrupt { threadId, turnId }` during a running `sleep 30`; `turn/completed` arrived with `status: "interrupted"` immediately. |
| List past sessions | `thread/list { cwd }` filters by project. Includes sessions started from the `codex` CLI (`source: "cli"`), so external sessions can be resumed. |
| History | `thread/turns/list { threadId, itemsView: "full" }` from a fresh app-server process returned every turn with full items, using the **same `ThreadItem` type as the live stream**, including interrupted turns. |
| Resume | `thread/resume { threadId }` in a fresh process, then `turn/start`; the model remembered the earlier turn. |

## Event model

- Lifecycle: `turn/started` → `item/started` / `item/completed` per item (completed is authoritative) → `turn/completed { turn: { status } }`.
- Streaming deltas keyed by item id: `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/commandExecution/outputDelta`, `item/plan/delta`. Also `turn/diff/updated`, `thread/tokenUsage/updated`, `thread/status/changed`.
- `ThreadItem` is a discriminated union on `type`: `userMessage`, `agentMessage`, `reasoning`, `plan`, `commandExecution`, `fileChange` (with per-file `changes[].diff`), `mcpToolCall`, `dynamicToolCall`, `webSearch`, `contextCompaction`, subagent items and more. Unknown types must fall back to generic rendering.
- `serverRequest/resolved` confirms a pending request was answered or cleared.
- `turn/steer` adds input to a running turn, which maps onto message queueing.

## Implications for the agent abstraction

- **One mapping for live and history.** Both arrive as `ThreadItem`, so a single Codex-to-Escritoire item mapper serves both. If the Claude Agent SDK's `getSessionMessages` likewise returns the same message type as `query()` (check in slice 2), the shared model can be "a transcript of items, upserted by id as events arrive".
- **Pending requests are first-class.** Both agents block a turn on a user decision (Codex: server requests; Claude: the `canUseTool` callback and question tools). Model them as pending requests attached to a session, which also drives the "waiting for input" state.
- **Session identity:** Codex `thread.id` (UUIDv7) plays the role of Claude's session id.

## Details for slice 6

- `item/fileChange/requestApproval` carries no diff. Join it to the item from `item/started` by `itemId`.
- Calls to our own MCP server's tools ask for approval via elicitation. Auto-accept elicitations whose `serverName` is ours rather than asking the user.
- One app-server process can host many threads. Decide between one process per app, per project or per session when building it; per-project limits the blast radius of a crash.
- app-server labels its threads `source: "vscode"` regardless of client; our `clientInfo` appears in the user agent.
- Use the user's installed `codex` binary, configurable like the Claude Code executable, and generate types from it (`codex app-server generate-ts --out <dir>`). Many methods are experimental and need `capabilities.experimentalApi`; none of the methods above did.
