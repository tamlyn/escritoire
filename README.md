<center>

# Escritoire

<img src="docs/images/escritoire.png" alt="Engraving of a writing desk with a fold-out top and many drawers" width="120">

</center>


Yet another vibe coded agentic IDE.

## What's so special about this then?

- Integrated process manager so you can see the processes started by your agents, and they can see the logs of your processes
- Client-server architecture so you can:
  - Manage stuff from your mobile over Tailscale
  - Run agents on remote machines
- Open any number of projects and agent sessions with minimal memory use
- Save and reload project state
- Claude and Codex presented in the same GUI style
- Run `.sql` files line-by-line against your database (DataGrip style)

### And the usual stuff

- Git viewer
- Terminal tabs
- Lightweight editor
- Light and dark modes
- Use your existing Claude and Codex subscription

### But not this stuff

- No plugins or themes
- No code completion
- No language servers

## Running it

You'll need Node, pnpm and, for Codex, the `codex` CLI installed and logged in.

```sh
pnpm install
pnpm dev
```

`pnpm dist` packages the app for your machine into `dist/`. Linux builds come from GitHub Actions.
