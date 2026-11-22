# Escritoire: plan

What is still to build. [HISTORY.md](HISTORY.md) holds what this is, the decisions made, the tech stack and the requirements of what's already built; read it first.

This document captures direction, not an exhaustive specification. Build iteratively and resolve edge cases as they arise. Discuss substantial architecture choices before committing; routine implementation details can be worked out along the way. When a feature is built, move its requirements to HISTORY.md.

## From use

Noticed using Escritoire day to day (November 2026).

### Missing features

- **Several windows**, each showing one project. Per-client state already makes each window just another client. This amends decision 7 (one project in view per window rather than per app), which HISTORY.md should say when built.
- Dropping a file from the tree onto the tabs opens it where it was dropped, including in a new split, as if it had been opened and its tab dragged there.
- A rendered Markdown view, a simple image viewer, and wrapping long lines in the editor.
- Git graph view can get very wide - need a better layout algorithm.
- Project-level find (⌘⇧F, as WebStorm), and make the find-in-file look better
- Create new project
- Auto-complete project names from any sibling of an existing project
- Don't ask for confirmation to open links

## Architecture

From an architecture review (November 2026): places where one concept is spread across several modules, or where rules live where no unit test reaches them.

- **Main owns what's open in a project.** The desktop treats "open" as having a tab, and main parses the layout to find them (`ProjectStore.sessionTabs`); the phone treats it as loaded in main, reads the desktop layout for terminals and keeps its own localStorage list. Main would keep each project's open sessions and terminals as data that layouts and phone views reference, with opening and closing as API calls. Touches the rule that the layout belongs to the renderer; the phone still never writes it.
- **Rules out of `createApi`.** Saving a SQL connection's password to `~/.pgpass`, moving SQL connections on rename, telling other clients about a write, and the git fallback for listing files sit in `createApi`, which imports Electron, so only e2e tests reach them. Move each into the module that owns it and `createApi` into an Electron-free file.
- **One cache for agent probes.** Setting choices, commands and past sessions are cached at four levels with different keys and lifetimes (the renderer's ignores the project). SessionManager would own them all under one stale-while-refresh policy.

## Features

### Remote access

Use Escritoire from a phone, and later from another computer, over the user's Tailscale network. The phone is for keeping agents moving away from the desk: seeing what needs attention, reading sessions, answering questions and permission requests, and sending messages. Tailscale isn't allowed on the work machine, so this is for the personal machine only.

Pairing, revocation, serving the renderer to a browser, reconnecting by snapshot, the phone layout, and Web Push are built (see Remote access in HISTORY.md).

- **Attachments other than images**, or uploads into the project, get an HTTP upload on the same listener only when needed.
- **Git and processes on the phone** come only when missed.
- **Remote sessions between computers come later.** The same transport lets Escritoire on one computer view a project hosted by Escritoire on another, so agents keep running while a laptop sleeps. Paths, processes, terminals and agents then belong to the host, not the viewing machine. Running main headless (without a window) belongs to that later slice.

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
- **Headless mode** for a server without a display, used only through remote access. A `--headless` flag that creates no window and doesn't quit for lack of one, turns remote access on, prints a pairing code at startup (enabling and pairing are otherwise desktop-only), and treats the desktop as never present so attention goes to push. Electron still needs a display on Linux: try `--ozone-platform=headless`, else Xvfb. Running main as plain Node is the further step; the Electron-specific parts are the window, `presence.ts`, `desktop-attention.ts`, `shell.trashItem` and `app.getPath`. Until then, run under `xvfb-run` and pair once through the hidden window.

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
