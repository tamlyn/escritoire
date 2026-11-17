# Escritoire: plan

What is still to build. [HISTORY.md](HISTORY.md) holds what this is, the decisions made, the tech stack and the requirements of what's already built; read it first.

This document captures direction, not an exhaustive specification. Build iteratively and resolve edge cases as they arise. Discuss substantial architecture choices before committing; routine implementation details can be worked out along the way. When a feature is built, move its requirements to HISTORY.md.

## Next slices

Starting priorities, not fixed release gates. Try each increment and let actual use determine the next improvement.

1. The bugs under "From use", below.
2. Attention across projects: the inbox, dock badge, OS notifications and switcher ordering.
3. The Orca review pass (see below).
4. Remote access from a phone over Tailscale, in the build order given in that section.

The other items under "From use", and agent session features from the VS Code extension that aren't yet built, are added in the order they are missed, alongside these slices.

## From use

Noticed using Escritoire day to day (November 2026).

### Agent sessions

- **Esc shouldn't interrupt**: it's too easy to hit by accident. The stop button does.
- **Subscription usage** (five-hour and weekly) beside context usage. The Agent SDK reports Claude's plan limits when they apply, not for an API key or Bedrock; check what app-server reports for Codex.
- **File links in agent messages open in the editor**, including a line number (`/path/to/PLAN.md:83`). Paths outside the project open too.
- **Thinking is collapsed by default.**
- **Queued messages are shown above the composer** until sent, where each can be edited or cancelled. Today Claude's look like sent messages and Codex's aren't shown at all.

### Workspace and editor

- **Several windows**, each showing one project. Per-client state already makes each window just another client. This amends decision 7 (one project in view per window rather than per app), which HISTORY.md should say when built.
- Dropping a file from the tree onto the tabs opens it where it was dropped, including in a new split, as if it had been opened and its tab dragged there.
- A rendered Markdown view, a simple image viewer, and wrapping long lines in the editor.

### Remote access

- **Offer to run `tailscale serve`** from the remote access dialog when the `tailscale` CLI is found, and show the resulting URL; otherwise show the command to run.

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
- **Away means absent, not unfocused.** Web Push to a phone depends on whether the user is at the desktop (presence, in HISTORY.md), not on window focus, so walking away with Escritoire focused still notifies the phone. Treat the user as away after one minute idle rather than five.
- **Project switcher** orders projects needing attention first, then the rest by recency. Each row shows state at a glance: agents working or waiting, processes running or crashed.
- No jump-to-next-project shortcut is needed.

### Remote access

Use Escritoire from a phone, and later from another computer, over the user's Tailscale network. The phone is for keeping agents moving away from the desk: seeing what needs attention, reading sessions, answering questions and permission requests, and sending messages. Tailscale isn't allowed on the work machine, so this is for the personal machine only.

Pairing, revocation and serving the renderer to a browser are built (see Remote access in HISTORY.md).

- **Reconnect by snapshot.** A client that reconnects reopens what it shows and gets fresh snapshots, as on first open; no replay log until that proves too slow. A client whose send buffer grows past a threshold is disconnected and recovers the same way, which covers screen output and session events with one rule.
- **Attachments other than images**, or uploads into the project, get an HTTP upload on the same listener only when needed.
- **The phone is for driving agent sessions.** Its layout covers the attention loop first: the inbox, the project switcher, and session tabs (read, send, answer, interrupt, switch model and mode). Terminals and file editors are an occasional convenience there, added after the session loop works; git and processes come only when missed.
- **The phone keeps no workspace layout.** A project's saved layout belongs to the desktop. The phone derives its view from the session list and opens anything else as a transient view, so it never overwrites the desktop's tabs.
- **Notifications:** Web Push to paired phones when the user is away from the desktop (see Attention across projects). The dock badge and OS notifications stay with the desktop shell. On iOS this needs the web app added to the home screen.
- **Remote sessions between computers come later.** The same transport lets Escritoire on one computer view a project hosted by Escritoire on another, so agents keep running while a laptop sleeps. Paths, processes, terminals and agents then belong to the host, not the viewing machine. Running main headless (without a window) belongs to that later slice.

Build order:

1. The phone layout for sessions and attention, with reconnecting by snapshot.
2. Web Push.
3. Terminals and file editors on the phone.

## Later, if use shows a need

Nice to have, not scheduled.

### Updating without losing work

Installing a new version must not cost the user an agent's turn. See decision 13.

- Nothing yet tells the running app an update exists: the mac build is a bare app directory and Linux a tarball, with no updater. Decide how an update is installed and noticed first. With `asar` off, overwriting the app's files while it runs may break modules it loads later.
- When an update is ready, say so, and restart once no session is mid-turn or waiting for input. Sessions resume from their transcripts when next sent a message, as after any restart. A permission request left overnight would block that indefinitely, so the user can also restart at once.
- Start again the supervised processes that were running before the restart. This restores what was running rather than configuring restarts per process, so it doesn't contradict the non-goal below. Restarting still interrupts one-off processes mid-run, such as a migration, and running SQL queries.
- Shells restart with their scrollback and directory, as now. Keeping them alive across a restart needs a long-lived process holding the ptys (VS Code's pty host); build it only if losing shells proves painful.

### IDE context for agents

Rarely needed: the user @-mentions files instead.

- The active file and selection, scoped to the agent session's project even while the user views another: that project's last active file editor tab and its selection, from the most recently active client.
- Agents show the user a diff only when asked to, never unprompted.
- The same for Claude and Codex.

### Other

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
