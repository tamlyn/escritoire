# Escritoire: Agentic IDE

## What this is

A personal desktop IDE built around coding agents rather than around a text editor. The user no longer writes code and rarely reads it. Their day is spent directing agents (mainly Claude, sometimes Codex) across several projects at once, checking what changed, editing config files, running and restarting project processes, and occasionally querying a database.

Existing tools each get part of this right and none gets all of it:

- **JetBrains** is the baseline the user knows well, but it is resource-hungry, costs money and is built for writing code.
- **VS Code** has a layout the user finds busy and confusing. Its Claude Code extension is liked (preferred over the terminal UI), but it can't be used in VS Code's agent view.
- **JetBrains Air** was tried and didn't click. Claude Code only runs there as a terminal UI.

This document captures the direction and current decisions, not an exhaustive specification. Build iteratively and resolve edge cases as they arise. Discuss substantial architecture choices before committing; routine implementation details can be worked out along the way.

## Users and scope

- Single user, personal tool. Not a product for distribution (yet). Avoid decisions that would make later distribution impossible, but don't build for it.
- Several projects open at once, usually each with one or more agent sessions.
- Operating systems: **macOS** (personal machine) and **RHEL 8.10** (work machine). RHEL 8 is the constraining platform: glibc 2.28, old system libraries. Claude Code's TUI, VS Code and WebStorm all run on it today.

## Decisions made

1. **Claude is integrated through the Claude Agent SDK**, not through ACP and not by embedding the terminal UI. Reason: it is first-party, ships alongside Claude Code, and gives new Claude features on release.
2. **Codex integration is open: ACP or a native Codex interface, whichever is simpler.** OpenAI's [Codex app-server](https://developers.openai.com/codex/app-server) is intended for rich clients and exposes conversation history, approvals and streamed events. Compare it with ACP in a small spike before choosing.
3. **The IDE has its own internal agent abstraction**, with one adapter per agent. The shared core (messages, tool calls, permission requests, file changes, session state) must look and behave the same for both agents: the same tab type and the same chat component. ACP's shapes are a useful reference, but the abstraction should follow the needs of both integrations. Agent-specific extras are allowed as optional additions; they must not lower the shared core to the least capable agent.
4. **Authentication uses the user's own existing logins** for Claude Code and Codex. The IDE must never implement its own Claude.ai login or handle subscription credentials itself, and must never misreport what it is to Anthropic's API. See "Platform notes" for how authentication differs by machine.
5. **Everything is a tab.** Agent sessions, files, terminals, process output, git views and SQL consoles all live as normal tabs in the main area. No bottom panel for terminals.
6. **The file tree is the one exception.** It is a side panel, not a tab, and can be collapsed.
7. **Multiple projects in one window, one project in view at a time.** The window shows only the active project's tabs and file tree; tabs never mix across projects. Explicit opening and closing is a sufficient starting point; automatic resource reaping is an optional optimisation.
8. **The IDE owns project processes** (see "Process supervision"). The design learns from the user's colleague's project, [The Running Man](https://github.com/elbeanio/the_running_man), but does not depend on it.
9. **No proprietary code is copied** from the Claude Code VS Code extension or any other closed-source tool.
10. **Electron, not Tauri.** Tauri v2 needs WebKitGTK 4.1 (libsoup 3), which RHEL 8 doesn't ship (Red Hat only adds it in RHEL 10), and WebKitGTK has known rendering and performance problems on Linux. Electron bundles Chromium, so it doesn't depend on the system web engine. Stock Electron 45 has been tested and runs on the work machine (RHEL 8.10, November 2026). The extra baseline memory (roughly 150–300 MB) is acceptable: releasing unused agent sessions is the more useful starting point for reducing memory.
11. **TypeScript throughout**, main process and renderer. The TypeScript Agent SDK is the one that bundles the Claude Code binary, and ACP has an official TypeScript SDK. One language keeps the codebase easy for agents to work in.

## Tech stack

Check current versions and APIs against documentation when adding each one.

| Concern | Choice | Reason |
|---|---|---|
| Shell and build | Electron with `electron-vite` | See decision 10 |
| UI | React | The chat UI is the hardest part; agents are most fluent in React |
| Styling and UI components | Tailwind CSS 4, shadcn/ui | Components are copied into the repo, so we own them. AI Elements builds on this stack |
| Layout | `react-resizable-panels`: `Workspace` for the tab area, panel groups for the file tree sidebar | `Workspace` provides tabsets in splits, drag-to-split, a serialisable layout model per project, custom tab rendering (for session state) and per-tab mount behaviour (keep terminals mounted). It is new (added in 4.17, November 2026) and changing fast: pin an exact version and keep it behind a thin wrapper of our own |
| Chat UI | Our own components, started from AI Elements (`ai-elements` CLI) and adapted; `streamdown` for Markdown | AI Elements is copied source, not a dependency, and is presentational, so our agent abstraction stays the only message model. Replace its AI SDK types with ours. Streamdown renders incomplete Markdown correctly while it streams. assistant-ui was rejected: still 0.x, and its runtime would add a second message model between the abstraction and the UI |
| Claude | `@anthropic-ai/claude-agent-sdk` | Decision 1. Provides `query()` with `resume`, plus `listSessions()` and `getSessionMessages()` for finding and displaying past sessions |
| Codex | Native `codex app-server`, or `@agentclientprotocol/sdk` talking to `@agentclientprotocol/codex-acp` | Choose after a small integration spike; decision 2 |
| Agent access to the IDE | `@modelcontextprotocol/sdk`: one MCP server over HTTP, bound to 127.0.0.1, token-protected | Both agents accept MCP servers, so the supervisor and IDE context tools are identical for Claude and Codex |
| Terminal | `@xterm/xterm`, `@xterm/addon-serialize`, `node-pty` | Interactive terminals, with serialised scrollback for restore |
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
- **Use the agents' standard configuration.** Claude should use the user's existing `~/.claude/settings.json` and normal project settings, including the existing work provider/proxy setup. Codex uses `~/.codex/config.toml` and trusted project `.codex/config.toml` settings ([configuration documentation](https://developers.openai.com/codex/config-basic)). Respect custom configuration locations supported by the agents. Avoid a separate IDE configuration system for these; verify that desktop-launched sessions receive any required environment variables.
- **Claude Code on RHEL 8 is not officially supported** and has had RHEL 8-specific regressions (v2.0.43 exited on start; v2.1.77 crashed with "Illegal instruction"). The IDE depends on the binary the SDK bundles, so a bad release could break the IDE at work. Make the Claude Code executable configurable (the SDK's `pathToClaudeCodeExecutable`) so a known-good binary can be pinned on that machine.

## Functional requirements

### Projects and workspace

- One project is active at a time. Switching projects swaps the whole set of tabs and the file tree.
- Each project remembers its own tabs and layout, across switches and across restarts.
- **Start with explicit opening and closing.** Closing a project releases its agent sessions, terminals and supervised processes while keeping its layout available to reopen. Closing a session releases its runtime while keeping its conversation available to resume. Automatic reaping can be added later if useful.
- Switching away does not close a project or stop its work. Only the active project's UI is rendered; background projects retain the state needed for their sessions, terminals and drafts.
- File watchers and git status polling run only for the active project, and refresh on switching in.
- Supervised processes are never stopped merely by switching away or by inactivity. Closing the project or quitting the app stops them.
- A user can remove a project from the list. This stops its processes and forgets its layout.

### Switching and attention

The user must be able to tell when another project needs them, without a persistent list of projects on screen.

- **Attention means unseen activity.** Viewing a session clears its unread indicator; an unanswered question or permission request still remains visibly in the waiting-for-input state until answered.
- Two levels: **waiting for input** (a question or permission request that blocks work, strongest signal) and an **unread finished turn** (weaker). A crashed process is a secondary signal.
- **One small persistent indicator:** a count of other projects needing attention, beside the active project's name. When the window is unfocused, also a dock badge and an OS notification.
- **Project switcher:** a keyboard-driven palette. Projects needing attention first, then the rest by recency. Each row shows state at a glance: agents working or waiting, processes running or crashed. Typing a path or fuzzy name in the same palette opens a new project; there is no separate "open project" UI.
- Tabs also show session state so activity elsewhere in the current project is visible. An inbox view may be useful later, but is not part of v1; no jump-to-next-project shortcut is needed.

### Agent sessions

- Start a Claude or Codex session in a project as a tab. One "new session" action with an agent picker; both agents open the same kind of tab. The agent is fixed once the session has messages, since transcripts aren't portable.
- A graphical chat interface, not a terminal UI. The Claude Code VS Code extension's chat panel is the reference: when behaviour is in doubt, do what it does. That covers the input side too (slash commands, @-mentions, image paste, model and mode switching, interrupt, message queueing) and features such as plan mode, agent questions, subagents and compaction. Build these in the order they are missed, not all up front.
- Show the agent's messages, tool calls and their results, and the changes it makes, in a readable form.
- **Generic fallback rendering:** a message or tool type the UI doesn't recognise is still shown, in a plain generic form. New agent features must degrade visibly, never disappear.
- **Permission requests:** when an agent wants to run a command or edit a file, show the request in the UI and send the user's answer back.
- Several concurrent sessions per project, and across projects.
- Show each session's state at a glance:
  - working;
  - waiting for input (e.g. an agent question or permission request);
  - finished but not yet read;
  - finished and read;
  - finished and read but with an unsent draft message;
  - errored.
- Find and resume past sessions. This naturally includes sessions started outside the IDE (e.g. `claude` in a separate terminal), since they live in the same on-disk store. Attaching to one that is still running elsewhere is out of scope.

### Session restore and optional reaping

- Reopening a session or restoring tabs after an app restart displays its saved history. Resume the agent when the user **sends a message**, not when they merely view the tab or type a draft.
- Restore the latest session settings, including model, permission mode and working directories. Keep the tab-to-session mapping stable.
- Prove history loading and resume for both adapters in the integration spike; do not assume identical transcript APIs. Prefer the provider's history support, adding IDE persistence only where needed.
- **Automatic reaping is secondary.** Explicit session and project closing is sufficient for v1. If added, only reap finished sessions, never working sessions or sessions waiting for input. Preserve history, read state and unsent drafts. Choose a timeout through use rather than promising token-cost equivalence.

### Process supervision

Problem being solved: if the user runs a process from the IDE, agents can't see its output. If an agent runs it, the user can't easily see its status, and has to remember which session owns the backend.

- **Run from the file:** when viewing `package.json` or `mise.toml`, each script or task has a run icon in the gutter, as in WebStorm. There is no discovery pass over unopened files and no per-process configuration.
- Long-running and one-off processes are treated the same.
- Each process's output is a tab. It can be restarted or stopped individually.
- One copy of each process per project, owned by the IDE, not by any agent session. Use a common task identity for gutter and agent launches; arbitrary commands include their working directory and relevant launch options. Starting an already-running process returns the existing instance, atomically, so concurrent requests cannot create duplicates.
- **Quit and crash:** quitting the app or closing a project stops its supervised processes. Child processes do not automatically die with their parent. Proposed approach: a small supervisor helper owns process groups and watches a private pipe from the app; when the app exits or crashes, the pipe closes and the helper stops those groups. Keep that pipe out of task processes so they cannot hold it open. Verify this on macOS and RHEL in the supervisor slice. This covers ordinary supervised commands; detached daemons and failure of the helper itself are not a blanket guarantee. Do not kill processes on the next launch based solely on saved IDs, which can be reused. See [pipe lifecycle](https://man7.org/linux/man-pages/man7/pipe.7.html); Linux also has a [parent-death signal](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html), but it is not inherited by forked children and is not a portable whole-tree solution.
- **Agents and the user share one interface.** An agent can list processes, check whether one is running, read recent or filtered output, see recent errors across all processes, and start, restart or stop processes. It does this through the same supervisor the user sees.
- **Agents should use the supervisor for anything backgrounded.** Agents run ordinary foreground commands themselves, untouched. Deny Claude Bash calls with `run_in_background` and point to the supervisor tool. For Codex, use instructions plus the chosen integration's supported controls. This enforces the supported background mechanism, not every possible way a shell command can detach a process.

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

- IDE context is always scoped to the agent session's project, even while the user is viewing another project. Return that project's last active file editor tab and its selection, or no file if none has been viewed.
- No open-file inventory or change inventory is needed from MCP; agents use git to inspect changes. Supervisor tools are likewise scoped to the session's project.
- Agents can show a change to the user for review.
- **Same for both agents.** This must be available to Claude and Codex identically.

### Files

- File tree for each project.
- View files, and edit config files (JSON, YAML, TOML, env and similar) with syntax highlighting. A full code-editing experience is not required.
- Make it obvious when a file is being changed by an agent.
- File tabs persist as path and scroll position.
- **Autosave promptly**, including when an editor tab loses focus. There is no manual-save workflow; do not design around long-lived unsaved editor buffers.

### Git

- **A summary, not detailed review:** which files changed (staged, unstaged, untracked) and how much, per project.
- Commit history at a glance.
- Optionally drill into a file's diff. This is secondary.
- Useful if feasible: relate changes to the agent session that made them.

### Terminal

- Ordinary interactive terminals, as tabs, opened in a project's directory.
- Closing a terminal tab or its project stops the shell; switching projects leaves it running. This provides explicit resource release without automatic terminal reaping.
- On project close or normal app quit, save terminal scrollback and working directory for tabs that will be restored. Reopening starts a fresh shell with the old scrollback above a visible "restored" marker. Shell variables, activated virtualenvs and running jobs are not restored.
- Automatic terminal reaping is optional later work. If added, require reliable idle detection on both platforms and leave a terminal running when uncertain; a foreground process name alone is insufficient.

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

- The tech stack is agreed except for the Codex integration choice. Propose the broad internal architecture (process boundaries, the agent abstraction, IPC between main and renderer) before building. Leave detailed edge cases to implementation and feedback.
- Build in thin vertical slices that the user can try early. Suggested priority, highest first:
  1. Window with projects and tabs.
  2. Claude session tab: start with send, streaming output, tools, questions/permissions and interrupt; then add history and resume. Explicit closing is enough initially. Then set up the RHEL build on GitHub Actions, since this is the first slice worth trying at work.
  3. File tree and config editing. `@parcel/watcher` is the first native module, so this is where the EL8 native build toolchain is proven.
  4. Terminal tabs and process supervision, with agent access to the supervisor.
  5. Git overview.
  6. Codex using the integration selected in the spike.
  7. SQL query files.
- These are starting priorities, not fixed release gates. Try each increment and let actual use determine the next improvement; automatic reaping and an inbox can wait.
- Before freezing the agent abstraction's types in slice 2, run a small Codex spike comparing native app-server and ACP. Check history loading, resume, permissions, interruption and MCP access against the shared UI's needs.
- Check details of the agent integrations against current documentation rather than memory; they are evolving quickly.
- From slice 2 onwards, try each slice on RHEL 8 as well as macOS, using the GitHub-built release. Native modules and the Claude Code binary are where platform problems will show up.
