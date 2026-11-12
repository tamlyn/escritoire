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
- Operating system: **to confirm with the user** before choosing anything platform-specific.

## Decisions made

1. **Claude is integrated through the Claude Agent SDK**, not through ACP and not by embedding the terminal UI. Reason: it is first-party, ships alongside Claude Code, and gives new Claude features on release.
2. **Codex is integrated through ACP** (Agent Client Protocol).
3. **The IDE has its own internal agent abstraction**, with one adapter per agent. The shared core (messages, tool calls, permission requests, file changes, session state) must look and behave the same for both agents. Agent-specific extras are allowed as optional additions; they must not lower the shared core to the least capable agent, nor force Claude down to what ACP supports.
4. **Authentication uses the user's own existing logins** for Claude Code and Codex. The IDE must never implement its own Claude.ai login or handle subscription credentials itself.
5. **Everything is a tab.** Agent sessions, files, terminals, process output, git views and SQL consoles all live as normal tabs in the main area. No bottom panel for terminals.
6. **The file tree is the one possible exception.** It may be a persistent side element rather than a tab. Treat this as a provisional decision to validate with the user.
7. **Multiple projects in one window**, grouped so it is always clear which project a tab belongs to.
8. **The IDE owns project processes** (see "Process supervision"). The design learns from the user's colleague's project, [The Running Man](https://github.com/elbeanio/the_running_man), but does not depend on it.
9. **No proprietary code is copied** from the Claude Code VS Code extension or any other closed-source tool.

## Functional requirements

### Projects and workspace

- Open, close and switch between several projects in one window.
- Clearly group tabs by project.
- Restore the workspace (projects, tabs, layout) across restarts.

### Agent sessions

- Start a Claude or Codex session in a project as a tab.
- A graphical chat interface, not a terminal UI. The Claude Code VS Code extension's chat panel is the reference for feel.
- Show the agent's messages, tool calls and their results, and the changes it makes, in a readable form.
- **Permission requests:** when an agent wants to run a command or edit a file, show the request in the UI and send the user's answer back.
- Several concurrent sessions per project, and across projects.
- Show each session's state at a glance: working, waiting for the user, waiting for permission, idle, or errored.
- Find and resume past sessions.

### Session reaping and resume

The user often leaves many sessions open for days. Each one holds memory.

- Release the resources of idle sessions, then resume them transparently when the user returns.
- **Only reap a session that is waiting for user input.** Never reap one that is mid-turn, running a subagent or waiting on a permission prompt.
- The default threshold must be longer than the prompt-cache lifetime. After that point, resuming costs nothing extra compared with keeping the process alive. The threshold should be configurable.
- A reaped session's tab still shows its full history and looks normal. Resuming happens when the user interacts with it, with minimal delay.
- Resume must restore the session's original settings: model, permission mode, working directories and any other launch options.
- The tab-to-session mapping must stay stable across reap and resume.
- Expected: reaping kills child processes the agent started itself. This is one reason long-running processes belong to the IDE's supervisor, not to agents.

### Process supervision

Problem being solved: if the user runs a process from the IDE, agents can't see its output. If an agent runs it, the user can't easily see its status, and has to remember which session owns the backend.

- **Discover runnable commands:** at minimum, `package.json` scripts and `mise.toml` tasks. Run one with a click.
- **Two kinds of process:** long-running ones (dev servers, workers, watchers) and one-off ones (builds, tests, scripts).
- Each process's output is a tab. It can be restarted or stopped individually.
- One copy of each process per project, owned by the IDE, not by any agent session.
- **Agents and the user share one interface.** An agent can list processes, check whether one is running, read recent or filtered output, see recent errors across all processes, and start, restart or stop processes. It does this through the same supervisor the user sees.
- **Agents should naturally prefer the supervisor** over spawning their own copies. Provide whatever instructions or tools make that happen for both Claude and Codex.

Learnings from The Running Man to carry over:

- The human and agent interfaces are the same data, not parallel systems.
- "Is it already running?" must be cheap for an agent to answer before it starts anything.
- Agents should be able to discover the supervisor from inside the project without configuration.
- **Start order and readiness:** some processes depend on others being ready, e.g. the backend's port accepting connections.
- **Errors in one place:** an "errors anywhere in the stack, recently" view is high value.
- **Readable errors:** multi-line output such as stack traces should be grouped as one entry, not fragmented.
- **Optional auto-restart** on crash, per process.
- **Local only:** the control interface must not be exposed on the network.
- **Bounded log retention.**

Open question: whether Docker Compose services are in scope for v1.

### IDE context for agents

- Agents can query IDE context: the active file, the selection, open files, and what has changed.
- Agents can show a change to the user for review.
- **Same for both agents.** This must be available to Claude and Codex identically.

### Files

- File tree for each project.
- View files, and edit config files (JSON, YAML, TOML, env and similar) with syntax highlighting. A full code-editing experience is not required.
- Make it obvious when a file is being changed by an agent.

### Git

- **A summary, not detailed review:** which files changed (staged, unstaged, untracked) and how much, per project.
- Commit history at a glance.
- Optionally drill into a file's diff. This is secondary.
- Useful if feasible: relate changes to the agent session that made them.

### Terminal

- Ordinary interactive terminals, as tabs, opened in a project's directory.

### SQL

- A basic SQL console tab: saved connections, run a query, see results in a grid.
- No autocomplete needed.
- Open question: which database engines. Ask the user.

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

## Open questions for the user

1. Which operating system or systems?
2. Is the file tree a side panel or a tab? (Decision 6 is provisional.)
3. Which SQL databases?
4. Are Docker Compose services in scope for v1 process supervision?
5. Default reaping threshold?
6. Should sessions started outside the IDE (e.g. `claude` in a separate terminal) be visible and resumable from it?

## Suggested approach for the builder

- Start by proposing the architecture and tech stack against these requirements, including the trade-offs considered. Get agreement before building.
- Build in thin vertical slices that the user can try early. Suggested priority, highest first:
  1. Window with projects and tabs.
  2. Claude session tab.
  3. File tree and config editing.
  4. Process supervision, with agent access.
  5. Git overview.
  6. Session reaping and resume.
  7. Codex via ACP.
  8. SQL console.
- Check details of the Agent SDK and ACP against current documentation rather than memory; both are evolving quickly.