# Escritoire: history

What has been decided and built, and why. [PLAN.md](PLAN.md) holds what is still to build. Requirements here still describe how the app must behave: change them deliberately, not in passing.

## What this is

A personal desktop IDE built around coding agents rather than around a text editor. The user no longer writes code and rarely reads it. Their day is spent directing agents (mainly Claude, sometimes Codex) across several projects at once, checking what changed, editing config files, running and restarting project processes, and occasionally querying a database.

Existing tools each get part of this right and none gets all of it:

- **JetBrains** is the baseline the user knows well, but it is resource-hungry, costs money and is built for writing code.
- **VS Code** has a layout the user finds busy and confusing. Its Claude Code extension is liked (preferred over the terminal UI), but it can't be used in VS Code's agent view.
- **JetBrains Air** was tried and didn't click. Claude Code only runs there as a terminal UI.
- **[Orca](https://github.com/stablyai/orca)** (found November 2026) is the closest match: the same stack and agent integrations, plus mobile and remote hosts. It is millions of lines built around parallel worktrees and many agents, has no process supervisor, and is too large and fast-moving to fork. See decision 12.

## Users and scope

- Single user, personal tool. Not a product for distribution (yet). Avoid decisions that would make later distribution impossible, but don't build for it.
- Several projects open at once, usually each with one or more agent sessions.
- Operating systems: **macOS** (personal machine) and **RHEL 8.10** (work machine). RHEL 8 is the constraining platform: glibc 2.28, old system libraries. Claude Code's TUI, VS Code and WebStorm all run on it today.

## Decisions made

1. **Claude is integrated through the Claude Agent SDK**, not through ACP and not by embedding the terminal UI. Reason: it is first-party, ships alongside Claude Code, and gives new Claude features on release.
2. **Codex is integrated through its native app-server** (`codex app-server`, JSON-RPC over stdio), not ACP. The current `codex-acp` adapter is itself a translation layer over app-server, so ACP adds a layer and a separately pinned Codex version without adding any capability. The spike (November 2026) proved history, resume, approvals, interrupt and per-thread MCP natively; see [docs/codex-app-server.md](docs/codex-app-server.md).
3. **The IDE has its own internal agent abstraction**, with one adapter per agent. The shared core (messages, tool calls, permission requests, file changes, session state) must look and behave the same for both agents: the same tab type and the same chat component. ACP's shapes are a useful reference, but the abstraction should follow the needs of both integrations. Agent-specific extras are allowed as optional additions; they must not lower the shared core to the least capable agent.
4. **Authentication uses the user's own existing logins** for Claude Code and Codex. The IDE must never implement its own Claude.ai login or handle subscription credentials itself, and must never misreport what it is to Anthropic's API. See "Platform notes" for how authentication differs by machine.
5. **Everything is a tab.** Agent sessions, files, terminals, process output, git views and SQL query files all live as normal tabs in the main area. No bottom panel for terminals.
6. **The file tree is the one exception.** It is a side panel, not a tab, and can be collapsed.
7. **Multiple projects in one window, one project in view at a time.** The window shows only the active project's tabs and file tree; tabs never mix across projects. Explicit opening and closing is a sufficient starting point; automatic resource reaping is an optional optimisation.
8. **The IDE owns project processes** (see "Process supervision"). The design learns from the user's colleague's project, [The Running Man](https://github.com/elbeanio/the_running_man), but does not depend on it.
9. **No proprietary code is copied** from the Claude Code VS Code extension or any other closed-source tool. Open-source code may be copied under its licence: for MIT code such as Orca's, keep its copyright notice with the copied portion.
10. **Electron, not Tauri.** Tauri v2 needs WebKitGTK 4.1 (libsoup 3), which RHEL 8 doesn't ship (Red Hat only adds it in RHEL 10), and WebKitGTK has known rendering and performance problems on Linux. Electron bundles Chromium, so it doesn't depend on the system web engine. Stock Electron 45 has been tested and runs on the work machine (RHEL 8.10, November 2026). The extra baseline memory (roughly 150–300 MB) is acceptable: releasing unused agent sessions is the more useful starting point for reducing memory.
11. **TypeScript throughout**, main process and renderer. The TypeScript Agent SDK is the one that bundles the Claude Code binary, and ACP has an official TypeScript SDK. One language keeps the codebase easy for agents to work in.
12. **Remote access is the IDE's own API served over Tailscale**, not Claude Remote Control and not a fork of Orca. The Agent SDK's Remote Control bridge was spiked (November 2026): it is `@alpha`, needs the IDE to read the user's claude.ai OAuth token, and covers Claude only. Orca has mobile and remote hosts but would mean maintaining millions of lines built around different priorities. Serving our own API covers both agents, adds no second session model, and extends to remote sessions between computers. Tailscale isn't allowed on the work machine, so remote access is for the personal machine only. See [Remote access](PLAN.md#remote-access).
    - **The transport is our own small protocol over a WebSocket**, not Cap'n Web. Its disposable capabilities would fit per-client views well, but it would mean reshaping the flat `Api` into capability objects on a young library; a per-client context released on disconnect gives the same result in the existing shape. The desktop window uses it too, replacing Electron IPC for the contract: two transports would serialise differently (structured clone keeps `undefined`, JSON drops it), so bugs would appear only on the rarely used remote path; the desktop exercises the remote code daily; and a later headless main needs the desktop to be a socket client anyway.
    - **No relay or tunnel of our own.** The listener stays on 127.0.0.1 behind pairing, so `tailscale serve` or `ssh -L` can publish it. A home-made relay is a large security surface, and on the work machine it would circumvent the Tailscale ban.
    - **The backend stays Node, not Rust.** The Agent SDK, the MCP SDK, the headless xterm mirror and node-pty are all TypeScript or Node, and memory goes on the `claude` processes and Chromium rather than on main. Reconsidered November 2026 alongside Tauri (decision 10, unchanged: remote access makes the desktop shell matter less, not more).
13. **Updates restart when agents are idle, rather than handing live sessions over.** The Agent SDK keeps a session's protocol state and pending permission callbacks in memory, and a new SDK instance can't reattach to a running `claude` process, so live handoff would mean reimplementing the SDK's side. Waiting until no session is mid-turn or waiting for input, then resuming from transcripts, loses nothing. Splitting main into a headless daemon wouldn't help much either, as most changes land in the services it would contain; that split belongs to remote sessions between computers. See [Updating without losing work](PLAN.md#updating-without-losing-work).

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
| Codex | Native `codex app-server`, using the user's installed `codex` binary | Decision 2. Generate protocol types with `codex app-server generate-ts` against the installed version |
| Agent access to the IDE | `@modelcontextprotocol/sdk`: one MCP server over HTTP, bound to 127.0.0.1, token-protected | Both agents accept MCP servers, so the supervisor and IDE context tools are identical for Claude and Codex |
| Terminal | `@xterm/xterm`, `@xterm/addon-serialize`, `node-pty` | Interactive terminals, with serialised scrollback for restore |
| Config editing and diffs | CodeMirror 6, `@codemirror/merge` | Syntax highlighting and diffs without Monaco's weight; a full editor is a non-goal |
| File watching | `@parcel/watcher` | Native, scales to large repos (VS Code uses it). Only projects that are some client's active one are watched |
| Git | The `git` CLI (`status --porcelain=v2 -z`, `log`, `diff --numstat`, `blame --porcelain`) | Uses the user's own config, credentials and hooks, which matters most for pull and push. isomorphic-git does its own auth and lacks blame of unsaved text; nodegit is another native module for EL8. The history graph's layout is ours: the known libraries draw illustrative diagrams rather than lay out a real log |
| Persistence | JSON files in the app data directory | Workspace layouts and attention state are small. Add SQLite only if a real need appears |
| Process logs | Bounded in-memory ring buffers per process | Meets bounded retention with no storage |
| SQL | Electron's built-in `node:sqlite` for SQLite; `pg` and `pg-cursor` for Postgres | `node:sqlite` needs no native module on EL8. It is synchronous and can't be interrupted, so each SQLite connection runs in a child process that cancelling kills. The cursor fetches only the rows shown |
| Remote access | A WebSocket server in main (`ws`), published with `tailscale serve`; Web Push for notifications | Decision 12. Node has a WebSocket client but no server. `tailscale serve` provides the tailnet-only exposure and the HTTPS that a home-screen web app, its service worker and push require |
| Fuzzy matching | `fzf` (a JS port of fzf's algorithm), bundled into the renderer | fzf's ranking and match positions without needing the `fzf` binary on each machine or a process per keystroke. Used by the palette and @-mentions |
| Tests | Vitest; Playwright driving Electron for end-to-end | Lets agents verify their own UI work |
| Package manager | pnpm | |
| Node | Managed with `asdf` | Development happens on the Mac only |

### Platform notes

- **Builds.** The Mac build is made locally, which avoids Gatekeeper quarantining an unsigned download. The RHEL build is made by GitHub Actions inside a Rocky or Alma Linux 8 container and downloaded as a release artefact; no development happens on the RHEL machine. Building in an EL8 container keeps native modules (`node-pty`, `@parcel/watcher`) linked against glibc 2.28. They must be rebuilt against Electron's Node ABI, which is expected to need a newer compiler than EL8's default GCC 8.5 (a `gcc-toolset`).
- **Claude authentication differs by machine.** Work: Bedrock through a proxy, configured by environment, with no subscription involved. Mac: the user's Claude Code subscription login. **Unverified:** whether Anthropic's current terms allow subscription use through the Agent SDK for a personal tool, and how it is metered. Check before building the Claude session slice. An API key is the fallback and needs no design change, since authentication lives inside the Claude Code binary.
- **Stock Claude Code behaviour is opt-in.** By default the SDK does not load Claude Code's system prompt, `CLAUDE.md` or the user's settings files. Enable the Claude Code preset and the settings sources so sessions behave like ordinary Claude Code.
- **Use the agents' standard configuration.** Claude should use the user's existing `~/.claude/settings.json` and normal project settings, including the existing work provider/proxy setup. Codex uses `~/.codex/config.toml` and trusted project `.codex/config.toml` settings ([configuration documentation](https://developers.openai.com/codex/config-basic)). Respect custom configuration locations supported by the agents. Avoid a separate IDE configuration system for these; verify that desktop-launched sessions receive any required environment variables.
- **Claude Code on RHEL 8 is not officially supported** and has had RHEL 8-specific regressions (v2.0.43 exited on start; v2.1.77 crashed with "Illegal instruction"). The IDE depends on the binary the SDK bundles, so a bad release could break the IDE at work. Make the Claude Code executable configurable (the SDK's `pathToClaudeCodeExecutable`) so a known-good binary can be pinned on that machine.

## Built features

### Projects and workspace

- One project is active at a time. Switching projects swaps the whole set of tabs and the file tree.
- Each project remembers its own tabs and layout, across switches and across restarts.
- **Explicit opening and closing.** Closing a project releases its agent sessions, terminals and supervised processes while keeping its layout available to reopen. Closing a session releases its runtime while keeping its conversation available to resume.
- Switching away does not close a project or stop its work. Only the active project's UI is rendered; background projects retain the state needed for their sessions, terminals and drafts.
- File watchers and git status polling run only for projects that are some client's active one, and refresh on switching in.
- Supervised processes are never stopped merely by switching away or by inactivity. Closing the project or quitting the app stops them.
- A user can remove a project from the list. This stops its processes and forgets its layout.
- **Project switcher:** a keyboard-driven palette, by recency. Typing a path or fuzzy name in the same palette opens a new project; there is no separate "open project" UI.
- **Opening files:** the same palette also matches the active project's files by fuzzy name, in a group below the matching projects. The list is fetched afresh each time the palette opens (git's tracked and untracked files, or a capped walk outside git), so there is no index to build or keep current.

### Attention within a project

- **Attention means unseen activity.** Viewing a session clears its unread indicator; an unanswered question or permission request still remains visibly in the waiting-for-input state until answered.
- Two levels: **waiting for input** (a question or permission request that blocks work, strongest signal) and an **unread finished turn** (weaker). A crashed process is a secondary signal.
- Tabs show session state so activity elsewhere in the current project is visible.

### Agent sessions

- Start a Claude or Codex session in a project as a tab. One "new session" action with an agent picker; both agents open the same kind of tab. The agent is fixed once the session has messages, since transcripts aren't portable.
- A graphical chat interface, not a terminal UI. The Claude Code VS Code extension's chat panel is the reference: when behaviour is in doubt, do what it does. That covers the input side too (slash commands, @-mentions, image paste, model and mode switching, interrupt, message queueing) and features such as plan mode, agent questions, subagents and compaction.
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
- **Starting a session shows progress and fails visibly.** Codex starts its app-server and a thread before the tab opens, which can take seconds, so the new tab's button shows it starting, and a failure (such as no Codex CLI) is shown in that tab. Claude starts when the first message is sent; a wrong `ESCRITOIRE_CLAUDE_CODE_PATH` or a missing login already ends the run with the reason in the session.
- **Codex modes are Codex's own presets**, each a sandbox and an approval policy together: read only, auto (write the workspace, ask to go beyond it) and full access. An approval policy alone isn't enough: the sandbox would come from Codex's config and folder trust, and in an untrusted folder's read-only sandbox "on-request" asks before every edit yet runs any command unasked. A thread in any other combination shows as custom. Permission profiles would replace this but are still experimental in app-server.
- **Slash commands.** A `/` that starts a message offers the agent's commands for the project, fetched afresh each time so newly added skills appear; choosing one inserts it and its arguments are typed after. The message is sent as typed. Claude Code runs commands itself and lists them through the SDK (`supportedCommands`), less `/model` and `/effort`, which the session controls own. `/clear` (or leaving plan mode with cleared context) makes Claude Code carry on as a new session; the tab follows it with an empty transcript, and the old session stays in the past sessions. Codex's own slash commands belong to its TUI, so the IDE offers `/clear` (a new thread in the same mode, which the tab follows as it does Claude's), and `/compact` and `/review [instructions]`, which map to app-server's compaction and review, plus Codex's enabled skills, sent with the skill attached.
- Find and resume past sessions. This naturally includes sessions started outside the IDE (e.g. `claude` in a separate terminal), since they live in the same on-disk store. Attaching to one that is still running elsewhere is out of scope.

### Session restore

- Reopening a session or restoring tabs after an app restart displays its saved history. Resume the agent when the user **sends a message**, not when they merely view the tab or type a draft.
- Restore the latest session settings, including model, permission mode and working directories. Keep the tab-to-session mapping stable.
- Prefer the provider's history support, adding IDE persistence only where needed.

### Process supervision

Problem being solved: if the user runs a process from the IDE, agents can't see its output. If an agent runs it, the user can't easily see its status, and has to remember which session owns the backend.

- **Run from the file:** when viewing `package.json` or `mise.toml`, each script or task has a run icon in the gutter, as in WebStorm. There is no discovery pass over unopened files and no per-process configuration.
- Long-running and one-off processes are treated the same.
- Each process's output is a tab. It can be restarted or stopped individually.
- One copy of each process per project, owned by the IDE, not by any agent session. Use a common task identity for gutter and agent launches; arbitrary commands include their working directory and relevant launch options. Starting an already-running process returns the existing instance, atomically, so concurrent requests cannot create duplicates.
- **Quit and crash:** quitting the app or closing a project stops its supervised processes. Child processes do not automatically die with their parent. Decided in the supervisor slice (November 2026): each process runs under a pty, so when the app exits or crashes the kernel hangs up the pty and its foreground process group receives `SIGHUP`. A test proves this on macOS and in the EL8 CI container, including a backgrounded grandchild. No helper process is needed. Processes that ignore `SIGHUP` or detach themselves (daemons, `nohup`, `setsid`) are not covered; add a helper only if that becomes a real problem. Do not kill processes on the next launch based solely on saved IDs, which can be reused.
- **Agents and the user share one interface.** An agent can list processes, check whether one is running, read recent or filtered output, see recent errors across all processes, and start, restart or stop processes. It does this through the same supervisor the user sees.
- **Ports:** each process shows the TCP ports its process tree is listening on, in the process list and its tab, and agents see them through `list_processes`. A port that answers HTTP links to the default browser. There is no OS notification when a process starts listening, so the supervisor polls (`lsof` on macOS, `ss` on Linux, since a minimal RHEL 8 install may lack `lsof`) every two seconds while anything runs. Each new port is probed once with `HEAD /`, which a dev server may log.
- **Agents should use the supervisor for anything backgrounded.** Agents run ordinary foreground commands themselves, untouched. Deny Claude Bash calls with `run_in_background` and point to the supervisor tool. For Codex, use instructions plus the chosen integration's supported controls. This enforces the supported background mechanism, not every possible way a shell command can detach a process.

Learnings from The Running Man carried over:

- The human and agent interfaces are the same data, not parallel systems.
- "Is it already running?" must be cheap for an agent to answer before it starts anything.
- Agents get the supervisor without configuration: the IDE passes its MCP server to every session it launches. Sessions started outside the IDE don't have it, which is accepted.
- **Errors in one place:** an "errors anywhere in the stack, recently" view is high value.
- **Readable errors:** multi-line output such as stack traces should be grouped as one entry, not fragmented.
- **Local only:** the control interface must not be exposed on the network.
- **Bounded log retention.**

### Files

- File tree for each project.
- View files, and edit config files (JSON, YAML, TOML, env and similar) with syntax highlighting. A full code-editing experience is not required.
- Make it obvious which files have changed: the file tree shows their git status. Open editors follow changes made on disk.
- File tabs persist as path and scroll position.
- **Autosave promptly**, including when an editor tab loses focus. There is no manual-save workflow; do not design around long-lived unsaved editor buffers.
- **New files are always real files in the project**, never unsaved buffers, so autosave, the tree, git, SQL connections and agents all work on them unchanged. One input, from ⌘N, the new tab page or the tree's context menu (which starts it in the clicked directory), takes either a path, creating any missing directories, or just an extension (`.sql`), which makes a scratch file named for the time in `.scratch/`. A scratch file is notes or a quick query; keeping it, committing it, or moving it to a proper path is up to the user, and whether `.scratch/` is ignored by git is up to each project. `./.env` names a dotfile.
- Rename (which can also move) and Move to Trash from the tree's context menu. Open tabs and SQL connections follow a rename. Deleting moves to the OS trash rather than asking for confirmation.

### Git

- **A summary, not detailed review:** which files changed (staged, unstaged, untracked) and how much, per project. The file tree colours changed files and the directories containing them.
- Commit history as a graph across local and remote branches and tags, with branch heads and tags labelled. A commit opens to show its message and files, each with its diff.
- Drill into a file's diff, staged, unstaged or in a commit.
- Switch branch, pull and push. These use the user's own git configuration and credentials; a prompt for credentials fails rather than waiting.
- Git blame in the editor gutter, toggled per file tab.
- Staging, committing, creating branches and resolving conflicts are left to agents and the terminal.

### Terminal

- Ordinary interactive terminals, as tabs, opened in a project's directory.
- Closing a terminal tab or its project stops the shell; switching projects leaves it running. This provides explicit resource release without automatic terminal reaping.
- On project close or normal app quit, save terminal scrollback and working directory for tabs that will be restored. Reopening starts a fresh shell with the old scrollback above a visible "restored" marker. Shell variables, activated virtualenvs and running jobs are not restored.

### SQL

- Query files, not a console, as in DataGrip: a `.sql` file opens in an ordinary file tab, with a connection picker and a Run button above the editor.
- Mod-Enter or Run runs the statement under the cursor, or every statement a selection touches. Statements run in order and stop at the first error. Results appear in a pane below the editor, one per statement, showing at most 500 rows. Errors are shown in place of a result. A running query can be cancelled.
- SQLite and Postgres. No autocomplete, schema browser or cell editing.
- **Connections belong to a project** and are kept in the app data directory, not the project. Each file remembers its connection; if a project has only one, every file uses it.
- **Escritoire stores no passwords.** Postgres uses `PGPASSWORD` or `~/.pgpass`, as git uses the user's own credentials, so psql shares them. A password typed in a connection's URL is moved to `~/.pgpass` (or `PGPASSFILE`) and the URL saved without it. The line goes first in the file so it wins over wildcard lines, replacing any for the same connection. Escritoire reads the file itself, since `pg` drops its own support in version 9.
- The dialog asks for the URL or file first, and names the connection after it (`database@host`, or the file's name) until the user names it.
- Each connection stays open between runs, so a transaction, `SET` or temporary table carries over, as in psql. Cancelling a SQLite query closes its connection, which rolls back any open transaction. Results aren't kept across restarts.

### Remote access

The first step towards using Escritoire from a phone (see [Remote access](PLAN.md#remote-access)).

- **One contract, one transport.** Clients reach main only through `api` and `subscribe` (`src/shared/api.ts`), carried over a WebSocket for every client, the desktop window included. Electron IPC is left with what only the desktop needs: the preload gives the window the listener's address and a token. Quitting still waits for calls in flight.
- **A small protocol of our own**, with no RPC library (decision 12). A client's first message is its token. Then requests `{id, method, args}` get replies `{id, result | error}`, and main pushes `{event, payload}`.
- **Values travel as JSON**, which drops `undefined`. So `null` resets a session setting to the agent's default, a trailing `undefined` argument is left off rather than sent as `null`, and the contract fails to compile if any method or event carries a value JSON would change.
- Listeners bind to 127.0.0.1 only. The desktop's token is random per launch and never stored. A browser page from any origin but the window's own is refused, as is a client without the token.
- **State per client, not per app.** Each connection is a client with its own active project, open session views, visibility and attached screens, released when it disconnects (`src/main/clients.ts`). Switching project in one client doesn't switch another; a client whose project another closes moves to the most recently active open one, and every client hears when the projects change. A new client starts in the project most recently active in any client, which is also where the desktop opens after a restart. Session events and screen output go only to the clients showing them.
- **A session is visible if any client whose user is there shows it**, which marks its turns read. The desktop stops counting as viewing when the screen locks or the system has been idle for five minutes, so walking away with Escritoire frontmost doesn't mark turns read.
- **A screen keeps the size it was given until another client types in it or resizes it**, so attaching a phone doesn't shrink the desktop's terminal. Only a client attached to a screen can type in it or resize it.
- **The same renderer build runs in a browser.** There is no separate mobile app and no second message model. The preload keeps only what is genuinely desktop-only: the desktop's connection, and flushing edits on quit.
- **Tailnet only, and paired.** `tailscale serve --bg <port>` publishes the remote listener to the tailnet over HTTPS; nothing depends on Tailscale itself, so `ssh -L` works too. Escritoire implements no login of its own, but Tailscale alone isn't enough: WebSockets ignore CORS, so any web page in the user's browser could connect to the loopback port, and agents on the same machine could connect and answer their own permission requests. So a browser pairs once, by typing a code the desktop shows, and keeps the resulting token.
  - **Two listeners.** The desktop window has its own, on any free port, which admits only the desktop's token and serves nothing else. Remote access adds a second on a fixed, configurable port (4729 by default), which serves the renderer's files, pairing and the API, and admits only paired tokens. Turning remote access on or off, or changing its port, disconnects every paired device but never the desktop. Remote access is off by default, when nothing listens on that port; that is the state on the work machine.
  - The remote listener refuses any `Host` but loopback names and `*.ts.net` (`tailscale serve` passes the original `Host` through), which stops a page whose DNS is rebound to this machine. A browser's `Origin` must match the `Host` it connects to, for the WebSocket and for pairing.
  - A pairing code is six digits, single-use, lasts five minutes and allows five wrong attempts.
  - The token travels in the first message, never in the URL, where it would be logged. A browser keeps it in local storage.
  - Main stores only hashes of paired tokens (`remote-access.json`), so reading the data directory yields nothing usable. An agent running as the user can still write to that directory, which is the same trust boundary as Claude Code's own.
  - The desktop's header has a remote access button, showing how many devices are connected. Its dialog turns remote access on and off, shows a pairing code, and lists paired devices, each of which can be revoked. Revoking disconnects the device, which then asks to pair again.
  - The `ts.net` hostname appears in public Certificate Transparency logs, which is accepted.
- **Main owns everything; every client is a view.** Any connected client can send prompts and answer questions and permission requests. The first answer wins: an answer to a request already settled is ignored, and the others see it resolved. Drafts live in main, so they follow the user between clients; the last write wins.
- **A lost connection fails the requests in flight** and shows a Reconnect button that reloads the page. Nothing is retried automatically: the composer keeps its text, and the fresh snapshot shows whether the message arrived.
- **Images are downscaled on the client** before sending (`renderer/src/session/images.ts`), since phone photos are large and Claude scales them down anyway.
- **Electron stays at the edge.** API methods don't depend on native dialogs, the dock or a local window, so every method works from a remote client.
- **Links to a process's port** point at the host's localhost, so they are plain text on a remote client.

## Slices built

All in November 2026, each tried on macOS and, from slice 2, on RHEL 8 through the GitHub-built release.

1. Window with projects and tabs.
2. Claude session tabs: send, streaming output, tools, questions and permissions, interrupt, then history and resume. The RHEL build on GitHub Actions came with this slice. The agent abstraction's types were checked against the Codex event model as well as the Claude Agent SDK's before being frozen ([docs/agent-abstraction.md](docs/agent-abstraction.md)).
3. File tree and config editing. `@parcel/watcher` proved the EL8 native build toolchain.
4. Terminal tabs and process supervision, with agent access to the supervisor through the IDE's MCP server.
5. Git overview, then the history graph, commits, blame, switch, pull and push, and change markers in the editor.
6. Codex through app-server.
7. SQL query files.
8. Ports in the process list.
9. Remote access, step 1: the desktop window's contract over a WebSocket.
10. Remote access, step 2: state per client, and presence at the desktop.
11. Remote access, step 3: pairing, revocation and serving the renderer to a browser.
