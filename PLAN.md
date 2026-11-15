# Escritoire: plan

What is still to build. [HISTORY.md](HISTORY.md) holds what this is, the decisions made, the tech stack and the requirements of what's already built; read it first.

This document captures direction, not an exhaustive specification. Build iteratively and resolve edge cases as they arise. Discuss substantial architecture choices before committing; routine implementation details can be worked out along the way. When a feature is built, move its requirements to HISTORY.md.

## Next slices

Starting priorities, not fixed release gates. Try each increment and let actual use determine the next improvement.

1. Attention across projects: the inbox, dock badge, OS notifications and switcher ordering.
2. IDE context for agents.
3. The Orca review pass (see below).
4. Remote access from a phone over Tailscale, in the build order given in that section.
5. Updating without losing work.

Agent session features from the VS Code extension that aren't yet built are added in the order they are missed, alongside these slices.

## Agent integration hardening from Orca

[Orca](https://github.com/stablyai/orca) uses the same Claude Agent SDK and Codex app-server integrations as Escritoire, with far more users finding the edge cases. Its handling of them is a free list of failure modes we will hit too.

- **One review pass** over Orca's `src/main/claude/` (especially `child-process/`, `sdk-transport/` and `configuration/`) and `src/main/codex/app-server/`. List each failure mode it handles and check whether our adapters do. The areas include:
  - child processes that don't exit, and killing the whole process tree;
  - startup failures and exits before or during the handshake, reported readably;
  - the environment given to the agent (inherited config directories, rejected API keys);
  - folder trust;
  - the user message queue and control requests;
  - oversized app-server frames, and app-server capabilities that vary by Codex version.

  Fix the gaps that matter, with a test that reproduces each one.
- **When an integration bug appears later**, check how Orca handles it before designing a fix.
- **Reimplement in our structure rather than transplanting files.** Orca's adapters are tightly coupled to the rest of its runtime (its Claude adapter imports its chat layer over a hundred times), so copied files would drag that design in. Copying a self-contained function is fine under its MIT licence; keep Orca's copyright notice with it (see decision 9 in HISTORY.md).

## Features

### Attention across projects

The user must be able to tell when another project needs them, without a persistent list of projects on screen. Attention within a project is built (see HISTORY.md); this extends it across projects.

- **Inbox in the top bar:** one small control beside the active project's name, showing a count of sessions in other projects that need attention. It opens a list of those sessions, waiting for input first, then unread finished turns, each with its project. Choosing one switches to that project and focuses the session. This is the one persistent attention indicator.
- When the window is unfocused, also a dock badge and an OS notification.
- **Project switcher** orders projects needing attention first, then the rest by recency. Each row shows state at a glance: agents working or waiting, processes running or crashed.
- No jump-to-next-project shortcut is needed.

### IDE context for agents

- IDE context is always scoped to the agent session's project, even while the user is viewing another project. Return that project's last active file editor tab and its selection, or no file if none has been viewed. With several clients connected, that is the most recently active across them.
- No open-file inventory or change inventory is needed from MCP; agents use git to inspect changes. Supervisor tools are likewise scoped to the session's project.
- Agents can show a change to the user for review.
- **Same for both agents.** This must be available to Claude and Codex identically.

### Remote access

Use Escritoire from a phone, and later from another computer, over the user's Tailscale network. The phone is for keeping agents moving away from the desk: seeing what needs attention, reading sessions, answering questions and permission requests, and sending messages. Tailscale isn't allowed on the work machine, so this is for the personal machine only.

- **One contract, one transport.** The renderer reaches main only through `window.api` and `subscribe` (`src/shared/api.ts`). That contract moves from Electron IPC to a WebSocket for every client, the desktop window included, and the same renderer build runs in a browser. There is no separate mobile app and no second message model. The desktop window gets a session token from main through the preload, held only in memory; the preload otherwise keeps only what is genuinely desktop-only (flushing edits on quit, native dialogs, the dock). Quitting still waits for calls in flight, as it does over IPC. See decision 12.
- **A small protocol of our own over a plain WebSocket.** Requests `{id, method, args}`, replies `{id, result | error}`, pushes `{event, payload}`, driven by `apiMethods` and `eventNames`. No RPC library: see decision 12. JSON loses `undefined`, so contract values must survive a JSON round trip: `changeSessionSettings` signals a reset to default with `undefined` today and must change. A unit test round-trips contract values through JSON to keep it that way.
- **Tailnet only, and paired.** Main's listener binds to 127.0.0.1; `tailscale serve` publishes it to the tailnet over HTTPS. Escritoire implements no login of its own. Tailscale alone is not enough: WebSockets ignore CORS, so any web page in the user's browser could connect to the loopback port, and agents on the same machine could connect and answer their own permission requests. So a client must also be paired once: the desktop shows a code or QR, and the browser keeps the resulting token. Nothing depends on Tailscale itself, so `ssh -L` works too.
  - The upgrade and the pairing endpoint check `Origin`.
  - A pairing code is single-use, short-lived and limited in attempts.
  - The token travels in the first message, never in the URL, where it would be logged.
  - Main stores only hashes of paired tokens, so reading the data directory yields nothing usable. An agent running as the user can still write to that directory, which is the same trust boundary as Claude Code's own.
  - The desktop lists paired devices and can revoke each.
  - The port is fixed, since `tailscale serve` needs a stable target, and configurable, so a dev instance and the installed app don't collide.
  - Remote access is off by default. With it off the listener still carries the desktop window's API, but serves no pairing endpoint and no renderer files. That is the state on the work machine.
  - The `ts.net` hostname appears in public Certificate Transparency logs, which is accepted.
- **Main owns everything; every client is a view.** Several clients may be connected at once: the desktop window, a phone, another computer. Any of them can send prompts and answer questions and permission requests. The first answer wins and the others see the request resolved. Viewing a session on any client marks it read. Drafts already live in main, so they follow the user between clients; the last write wins.
- **Viewing means the user is there.** Today a session is read when its tab is visible and the window focused, so walking away with Escritoire frontmost would mark turns read and leave the phone silent. The desktop stops counting as viewing when the screen locks or the system has been idle for a few minutes.
- **State per client, not per app.** Today the active project, a session's `visible` flag and a terminal's `attached` flag and size are each one value for the app, and events go to every window. Each connection becomes a client that holds its own active project, open session views, visibility and terminal attachments, and releases them when it disconnects. Switching project on the phone doesn't switch the desktop. Main watches the files and git state of every project that is some client's active one. A session is visible if any client shows it. A terminal takes the size of the client that last typed in it or resized it, so attaching a phone doesn't shrink the desktop's terminal.
- **Reconnect by snapshot.** Phones drop connections often. On reconnect a client reopens what it shows and gets fresh snapshots, as it does on first open; no replay log until that proves too slow. Requests pending when the connection drops fail and are never retried automatically: the composer keeps its text, and the fresh snapshot shows whether the message arrived. A client whose send buffer grows past a threshold is disconnected and recovers the same way, which covers screen output and session events with one rule.
- **Images are downscaled on the client** before sending, since phone photos are large and the models cap image size anyway. Other attachments, or uploads into the project, get an HTTP upload on the same listener only when needed.
- **The phone is for driving agent sessions.** Its layout covers the attention loop first: the inbox, the project switcher, and session tabs (read, send, answer, interrupt, switch model and mode). Terminals and file editors are an occasional convenience there, added after the session loop works; git and processes come only when missed.
- **The phone keeps no workspace layout.** A project's saved layout belongs to the desktop. The phone derives its view from the session list and opens anything else as a transient view, so it never overwrites the desktop's tabs.
- **Links to a process's port** point at the host's localhost, so they are hidden on a remote client.
- **Notifications:** Web Push to paired phones under the same rules as the dock badge and OS notifications, which stay with the desktop shell. On iOS this needs the web app added to the home screen.
- **Electron stays at the edge.** API methods must not depend on native dialogs, the dock or a local window, so every method works from a remote client.
- **Remote sessions between computers come later.** The same transport lets Escritoire on one computer view a project hosted by Escritoire on another, so agents keep running while a laptop sleeps. Paths, processes, terminals and agents then belong to the host, not the viewing machine. Running main headless (without a window) belongs to that later slice.

Build order:

1. Move the desktop window's contract to the WebSocket, with no change in behaviour. This goes to both machines and exercises the protocol daily.
2. Per-client state: active project, visibility and attachments, plus presence.
3. Pairing, revocation and serving the renderer to a browser.
4. The phone layout for sessions and attention.
5. Web Push.
6. Terminals and file editors on the phone.

### Updating without losing work

Installing a new version must not cost the user an agent's turn. See decision 13.

- When an update is ready, say so, and restart once no session is mid-turn or waiting for input. Sessions resume from their transcripts when next sent a message, as after any restart. A permission request left overnight would block that indefinitely, so the user can also restart at once.
- Start again the supervised processes that were running before the restart. This restores what was running rather than configuring restarts per process, so it doesn't contradict the non-goal below.
- Shells restart with their scrollback and directory, as now. Keeping them alive across a restart needs a long-lived process holding the ptys (VS Code's pty host); build it only if losing shells proves painful.

### Later, if use shows a need

- **Relate changes to the agent session that made them**, in the git view.
- **Automatic session reaping.** Only reap finished sessions, never working sessions or sessions waiting for input. Preserve history, read state and unsent drafts. Choose a timeout through use rather than promising token-cost equivalence.
- **Automatic terminal reaping.** Requires reliable idle detection on both platforms; leave a terminal running when uncertain. A foreground process name alone is insufficient.
- **Docker Compose services** in the supervisor. Not needed now; don't design them out.

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
- Multi-user collaboration. Remote access is for the same single user on their own devices.
- Distribution and packaging for other users.
- Process start order, readiness checks and auto-restart. All need per-process configuration, which the supervisor deliberately lacks.
- Git worktree support.

## Working on a slice

- Check details of the agent integrations against current documentation rather than memory; they are evolving quickly.
- Try each slice on RHEL 8 as well as macOS, using the GitHub-built release. Native modules and the Claude Code binary are where platform problems will show up. Remote access is the exception, being personal-machine only.
