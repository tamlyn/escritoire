# Escritoire: Agentic IDE

## What this is

A personal desktop IDE built around coding agents rather than around a text editor. The user no longer writes code and rarely reads it. Their day is spent directing agents (mainly Claude, sometimes Codex) across several projects at once, checking what changed, editing config files, running and restarting project processes, and occasionally querying a database.

Existing tools each get part of this right and none gets all of it:

- **JetBrains** is the baseline the user knows well, but it is resource-hungry, costs money and is built for writing code.
- **VS Code** has a layout the user finds busy and confusing. Its Claude Code extension is liked (preferred over the terminal UI), but it can't be used in VS Code's agent view.
- **JetBrains Air** was tried and didn't click. Claude Code only runs there as a terminal UI.

This document gives requirements and decisions. Implementation choices not listed under "Decisions made" are open: propose them, with reasoning, before committing.

## Users and scope

- Single user, personal tool. Not a product for distribution (yet). Avoid decisions that would make later distribution impossible, but don't build for it.
- Several projects open at once, usually each with one or more agent sessions.
- Operating systems: **macOS** (personal machine) and **RHEL 8.10** (work machine). RHEL 8 is the constraining platform: glibc 2.28, old system libraries. Claude Code's TUI, VS Code and WebStorm all run on it today.

## Decisions made

1. **Claude is integrated through the Claude Agent SDK**, not through ACP and not by embedding the terminal UI. Reason: it is first-party, ships alongside Claude Code, and gives new Claude features on release.
2. **Codex is integrated through ACP** (Agent Client Protocol).
3. **The IDE has its own internal agent abstraction**, with one adapter per agent. The shared core (messages, tool calls, permission requests, file changes, session state) must look and behave the same for both agents: the same tab type and the same chat component. The core is modelled on ACP's shapes (session updates, tool calls with status and diffs, permission requests with options), so the Codex adapter is close to a pass-through and the Claude adapter maps SDK messages into it. Agent-specific extras are allowed as optional additions; they must not lower the shared core to the least capable agent, nor force Claude down to what ACP supports.
4. **Authentication uses the user's own existing logins** for Claude Code and Codex. The IDE must never implement its own Claude.ai login or handle subscription credentials itself, and must never misreport what it is to Anthropic's API. See "Platform notes" for how authentication differs by machine.
5. **Everything is a tab.** Agent sessions, files, terminals, process output, git views and SQL consoles all live as normal tabs in the main area. No bottom panel for terminals.
6. **The file tree is the one exception.** It is a side panel, not a tab, and can be collapsed.
7. **Multiple projects in one window, one project in view at a time.** The window shows only the active project's tabs and file tree; tabs never mix across projects. There is no distinction between "open" and "recent" projects (see "Projects and workspace").
8. **The IDE owns project processes** (see "Process supervision"). The design learns from the user's colleague's project, [The Running Man](https://github.com/elbeanio/the_running_man), but does not depend on it.
9. **No proprietary code is copied** from the Claude Code VS Code extension or any other closed-source tool.
10. **Electron, not Tauri.** Tauri v2 needs WebKitGTK 4.1 (libsoup 3), which RHEL 8 doesn't ship (Red Hat only adds it in RHEL 10), and WebKitGTK has known rendering and performance problems on Linux. Electron bundles Chromium, so it doesn't depend on the system web engine; VS Code proves it on RHEL 8. The extra baseline memory (roughly 150–300 MB) is acceptable: agent processes dominate memory, which is what session reaping addresses.
11. **TypeScript throughout**, main process and renderer. The TypeScript Agent SDK is the one that bundles the Claude Code binary, and ACP has an official TypeScript SDK. One language keeps the codebase easy for agents to work in.

## Tech stack

Check current versions and APIs against documentation when adding each one.

| Concern | Choice | Reason |
|---|---|---|
| Shell and build | Electron with `electron-vite` | See decision 10 |
| UI | React | The chat UI is the hardest part; agents are most fluent in React |
| Claude | `@anthropic-ai/claude-agent-sdk` | Decision 1. Provides `query()` with `resume`, plus `listSessions()` and `getSessionMessages()` for finding past sessions and rendering reaped tabs |
| Codex | `@agentclientprotocol/sdk` (client side) talking to `@agentclientprotocol/codex-acp` | Decision 2 |
| Agent access to the IDE | `@modelcontextprotocol/sdk`: one MCP server over HTTP, bound to 127.0.0.1, token-protected | Both agents accept MCP servers, so the supervisor and IDE context tools are identical for Claude and Codex |
| Terminal | `@xterm/xterm`, `@xterm/addon-serialize`, `node-pty` | node-pty reports the foreground process (for reaping); the serialise addon saves scrollback (for restore) |
| Config editing and diffs | CodeMirror 6, `@codemirror/merge` | Syntax highlighting and diffs without Monaco's weight; a full editor is a non-goal |
| File watching | `@parcel/watcher` | Native, scales to large repos (VS Code uses it). Only the active project is watched |
| Git | The `git` CLI (`status --porcelain=v2 -z`, `log`, `diff --numstat`) | A summary needs no library |
| Persistence | JSON files in the app data directory | Workspace layouts and attention state are small. Add SQLite only if a real need appears |
| Process logs | Bounded in-memory ring buffers per process | Meets bounded retention with no storage |
| SQL | `better-sqlite3` for SQLite, `pg` for Postgres | Both widely used from Node. `better-sqlite3` is native, so it gets the same rebuild treatment as `node-pty` |
| Tests | Vitest; Playwright driving Electron for end-to-end | Lets agents verify their own UI work |
| Package manager | pnpm | |
| Node | Managed with `asdf` | Development happens on the Mac only |

### Platform notes

- **Builds.** The Mac build is made locally, which avoids Gatekeeper quarantining an unsigned download. The RHEL build is made by GitHub Actions inside a Rocky or Alma Linux 8 container and downloaded as a release artefact; no development happens on the RHEL machine. Building in an EL8 container keeps native modules (`node-pty`, `@parcel/watcher`, `better-sqlite3`) linked against glibc 2.28. They must be rebuilt against Electron's Node ABI, which is expected to need a newer compiler than EL8's default GCC 8.5 (a `gcc-toolset`).
- **Claude authentication differs by machine.** Work: Bedrock through a proxy, configured by environment, with no subscription involved. Mac: the user's Claude Code subscription login. **Unverified:** whether Anthropic's current terms allow subscription use through the Agent SDK for a personal tool, and how it is metered. Check before building the Claude session slice. An API key is the fallback and needs no design change, since authentication lives inside the Claude Code binary.
- **Stock Claude Code behaviour is opt-in.** By default the SDK does not load Claude Code's system prompt, `CLAUDE.md` or the user's settings files. Enable the Claude Code preset and the settings sources so sessions behave like ordinary Claude Code.
- **Claude Code on RHEL 8 is not officially supported** and has had RHEL 8-specific regressions (v2.0.43 exited on start; v2.1.77 crashed with "Illegal instruction"). The IDE depends on the binary the SDK bundles, so a bad release could break the IDE at work. Make the Claude Code executable configurable (the SDK's `pathToClaudeCodeExecutable`) so a known-good binary can be pinned on that machine.

## Functional requirements

### Projects and workspace

- One project is active at a time. Switching projects swaps the whole set of tabs and the file tree.
- Each project remembers its own tabs and layout, across switches and across restarts.
- **No open/closed state.** There is one list of projects, ordered by recency. A project the user hasn't visited for a while simply holds no live resources; nothing explicitly "unloads" it. This falls out of each resource releasing itself:
  - Only the active project's UI is rendered. Other projects are just saved layouts.
  - Agent sessions are reaped and resumed per "Session reaping and resume".
  - Idle terminals are reaped and restored per "Terminal".
  - File watchers and git status polling run only for the active project, and refresh on switching in. Agent edits in background projects are known from the agent's own tool calls.
  - Supervised processes are **never** stopped by switching away or by inactivity. Only the user (or an agent, via the supervisor) stops them. Quitting the app stops them all.
- A user can remove a project from the list. This stops its processes and forgets its layout.

### Switching and attention

The user must be able to tell when another project needs them, without a persistent list of projects on screen.

- **Attention means unseen, not merely waiting.** A session needs attention when it has changed state since the user last viewed its tab, like unread mail. Viewing the tab clears it. Otherwise sessions left idle for days would keep every project permanently flagged.
- Two levels: a **permission request** (blocks work, strongest signal) and a **finished turn** (weaker). A crashed process is a secondary signal.
- **One small persistent indicator:** a count of other projects needing attention, beside the active project's name. When the window is unfocused, also a dock badge and an OS notification.
- **Project switcher:** a keyboard-driven palette. Projects needing attention first, then the rest by recency. Each row shows state at a glance: agents working or waiting, processes running or crashed. Typing a path or fuzzy name in the same palette opens a new project; there is no separate "open project" UI.
- **Jump to next waiting:** one shortcut that switches to the project and focuses the tab that needs attention.

### Agent sessions

- Start a Claude or Codex session in a project as a tab. One "new session" action with an agent picker; both agents open the same kind of tab. The agent is fixed once the session has messages, since transcripts aren't portable.
- A graphical chat interface, not a terminal UI. The Claude Code VS Code extension's chat panel is the reference: when behaviour is in doubt, do what it does. That covers the input side too (slash commands, @-mentions, image paste, model and mode switching, interrupt, message queueing) and features such as plan mode, agent questions, subagents and compaction. Build these in the order they are missed, not all up front.
- Show the agent's messages, tool calls and their results, and the changes it makes, in a readable form.
- **Generic fallback rendering:** a message or tool type the UI doesn't recognise is still shown, in a plain generic form. New agent features must degrade visibly, never disappear.
- **Permission requests:** when an agent wants to run a command or edit a file, show the request in the UI and send the user's answer back.
- Several concurrent sessions per project, and across projects.
- Show each session's state at a glance: working, waiting for the user, waiting for permission, idle, or errored.
- Find and resume past sessions. This naturally includes sessions started outside the IDE (e.g. `claude` in a separate terminal), since they live in the same on-disk store. Attaching to one that is still running elsewhere is out of scope.

### Session reaping and resume

The user often leaves many sessions open for days. Each one holds memory.

- Release the resources of idle sessions, then resume them transparently when the user returns.
- **A session with no live process is the normal state, not a special one.** Restoring tabs after an app restart needs exactly this: render the tab from the on-disk transcript, and resume with the saved launch options on the next interaction. Reaping is then only a timer on top, so it is built with the session tab, not as a later feature.
- **Only reap a session that is waiting for user input.** Never reap one that is mid-turn, running a subagent or waiting on a permission prompt.
- The threshold must be longer than the prompt-cache lifetime (up to an hour). After that point, resuming costs nothing extra in tokens compared with keeping the process alive; the only cost is a short resume delay. **Default: 90 minutes**, configurable.
- A reaped session's tab still shows its full history and looks normal. Resuming happens when the user interacts with it, with minimal delay.
- Resume must restore the session's original settings: model, permission mode, working directories and any other launch options.
- The tab-to-session mapping must stay stable across reap and resume.
- Expected: reaping kills child processes the agent started itself. This is one reason long-running processes belong to the IDE's supervisor, not to agents.

### Process supervision

Problem being solved: if the user runs a process from the IDE, agents can't see its output. If an agent runs it, the user can't easily see its status, and has to remember which session owns the backend.

- **Run from the file:** when viewing `package.json` or `mise.toml`, each script or task has a run icon in the gutter, as in WebStorm. There is no discovery pass over unopened files and no per-process configuration.
- Long-running and one-off processes are treated the same.
- Each process's output is a tab. It can be restarted or stopped individually.
- One copy of each process per project, owned by the IDE, not by any agent session. A process is identified by its command and working directory.
- **Quit and crash:** quitting the app stops every supervised process. Because a crashed app can't clean up, process group IDs are recorded on disk and any leftovers are killed on the next launch.
- **Agents and the user share one interface.** An agent can list processes, check whether one is running, read recent or filtered output, see recent errors across all processes, and start, restart or stop processes. It does this through the same supervisor the user sees.
- **Agents use the supervisor for anything backgrounded.** Agents run ordinary foreground commands themselves, untouched. Starting a background process goes through the supervisor's "start a process" tool instead of the agent's built-in one. For Claude this is enforced: a Bash call with `run_in_background` is denied with a message pointing to the supervisor tool. For Codex, use instructions plus whatever enforcement ACP allows.

Learnings from The Running Man to carry over:

- The human and agent interfaces are the same data, not parallel systems.
- "Is it already running?" must be cheap for an agent to answer before it starts anything.
- Agents get the supervisor without configuration: the IDE passes its MCP server to every session it launches. Sessions started outside the IDE don't have it, which is accepted.
- **Errors in one place:** an "errors anywhere in the stack, recently" view is high value.
- **Readable errors:** multi-line output such as stack traces should be grouped as one entry, not fragmented.
- **Local only:** the control interface must not be exposed on the network.
- **Bounded log retention.**

Docker Compose services are not needed for v1. Don't design them out.

### IDE context for agents

- Agents can query IDE context: the active file, the selection, open files, and what has changed.
- Agents can show a change to the user for review.
- **Same for both agents.** This must be available to Claude and Codex identically.

### Files

- File tree for each project.
- View files, and edit config files (JSON, YAML, TOML, env and similar) with syntax highlighting. A full code-editing experience is not required.
- Make it obvious when a file is being changed by an agent.
- File tabs persist as path and scroll position. An unsaved edit keeps its buffer in memory; don't build draft persistence until it is needed.

### Git

- **A summary, not detailed review:** which files changed (staged, unstaged, untracked) and how much, per project.
- Commit history at a glance.
- Optionally drill into a file's diff. This is secondary.
- Useful if feasible: relate changes to the agent session that made them.

### Terminal

- Ordinary interactive terminals, as tabs, opened in a project's directory.
- **Reaping:** a shell can't be resumed like an agent session, so restore is deliberately lossy and honest about it.
  - Only reap a shell that is idle at its prompt, i.e. the pty's foreground process group is the shell itself. Never reap one with a foreground job (an editor, `psql`, a stray dev server).
  - On reap, save the scrollback and working directory. On return, start a fresh shell in that directory with the old scrollback shown above a visible "restored" marker.
  - Lost on restore: shell variables and exports, activated virtualenvs and similar in-memory shell state.
  - Same threshold mechanism as session reaping, configured separately. **Default: 3 days.** An idle shell costs a few megabytes and restore is lossy, so reap much later than agent sessions.
  - Terminal tabs survive an app restart through the same restore path: scrollback and working directory are saved on quit.

### SQL

- Query files, not a console, as in DataGrip: a `.sql` file opens in an ordinary file tab with a saved connection attached.
- Run the statement under the cursor, or a selection of several, and see results in a grid below.
- SQLite and Postgres.
- No autocomplete needed.

## Non-functional requirements

- **Lighter than JetBrains on memory and CPU**, especially with many projects and sessions open.
- **Calm, uncluttered layout.** The user explicitly dislikes VS Code's busy layout. Fewer always-visible elements, not more.
- **Robust to agent and process failures:** a crashed agent or process should not take down the IDE or other sessions.
- **Forward compatible:** new Claude Code features should be easy to surface; avoid designs that hard-code today's feature set.
- **Easy to iterate:** the user will develop this with Claude Code, so favour a codebase and tech stack that agents work well in.

## Non-goals (for now)

- Language intelligence: autocomplete, refactoring, go-to-definition, linting UI.
- Debuggers.
- An extension or plugin system.
- Agents other than Claude and Codex. The design should allow adding them later.
- Multi-user or remote collaboration.
- Distribution and packaging for other users.
- Process start order, readiness checks and auto-restart. All need per-process configuration, which the supervisor deliberately lacks.
- Git worktree support.

## Suggested approach for the builder

- The tech stack is agreed. Propose the internal architecture (process boundaries, the agent abstraction, IPC between main and renderer) before building, and get agreement.
- Build in thin vertical slices that the user can try early. Suggested priority, highest first:
  1. Window with projects and tabs. Set up the RHEL build on GitHub Actions here, with a native module included, so toolchain problems surface first.
  2. Claude session tab, including restore after restart, reaping and resume.
  3. File tree and config editing.
  4. Process supervision, with agent access.
  5. Git overview.
  6. Codex via ACP.
  7. SQL query files.
- Before freezing the agent abstraction's types in slice 2, spend a day on a throwaway Codex/ACP spike. An abstraction designed against one agent will be wrong.
- Check details of the Agent SDK and ACP against current documentation rather than memory; both are evolving quickly.
- Try each slice on RHEL 8 as well as macOS, early, using the GitHub-built release. Native modules and the Claude Code binary are where platform problems will show up.