<img src="docs/images/escritoire.png" alt="Engraving of a writing desk with a fold-out top and many drawers" width="240" align="right">

# Escritoire

An IDE for people who direct coding agents rather than write code themselves.

Most of my day is now spent telling Claude (and sometimes Codex) what to do across several projects, checking what they changed, restarting the dev server and tweaking a config file. Existing editors are built around typing code, so the agent is squeezed into a side panel. Escritoire turns that around. Agent sessions are the main thing and everything else is there to support them.

It's a personal tool. It runs on macOS and RHEL 8, because those are the machines I use.

## What it does

- Claude and Codex sessions as tabs, with the same chat interface for both. Each tab shows whether its agent is working, waiting for you or finished.
- Several projects open at once, one in view at a time, each remembering its own tabs and layout.
- Project processes owned by the IDE rather than by a terminal or an agent. Click the run icon next to a script in `package.json` and the agents can see its output, errors and status too.
- A file tree showing what changed, plus an editor for config files.
- A git summary, history graph, diffs and blame.
- Ordinary terminals, as tabs.

Claude and Codex use your existing logins and configuration. Escritoire never handles your credentials.

## Running it

You'll need Node, pnpm and, for Codex, the `codex` CLI installed and logged in.

```sh
pnpm install
pnpm dev
```

`pnpm dist` packages the app for your machine into `dist/`. Linux builds come from GitHub Actions.

## More

[HISTORY.md](HISTORY.md) explains the decisions behind it and what's built. [PLAN.md](PLAN.md) is what's next. [CLAUDE.md](CLAUDE.md) is the guide for agents working on the code, and is useful for humans too.
