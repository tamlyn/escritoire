<h1 align="center">Escritoire</h1>

<p align="center">
  <img src="docs/images/escritoire.png" alt="Engraving of a writing desk with a fold-out top and many drawers" width="120">
  <br><br>
  You're a writer now. Here is your writing desk.
  <br><br><br>
  <a href="docs/screenshots/overview.png"><img src="docs/screenshots/overview.png" width="400" /></a>
  &nbsp;&nbsp;
  <a href="docs/screenshots/overview-dark.png"><img src="docs/screenshots/overview-dark.png" width="400" /></a>
</p>

## What's so special about this then?

- Integrated process manager
  - You can see the processes started by your agents
  - Agents can see the logs of your processes
  - Single click start/stop/restart
  - Keep track of which processes are using which ports
- Client-server architecture
  - Looks like a normal Electron app
  - Manage stuff from your mobile over Tailscale or SSH
  - Run agents on remote machines with exactly the same UI as local
- Open any number of projects and agent sessions with minimal memory use
- Native Claude and Codex integration in the same GUI style
- Resume from summary when cache is cold

### And the usual stuff

- Git viewer
- Terminal tabs
- Lightweight editor
- Light and dark modes
- Use your existing Claude and Codex subscription
- Project state (tabs, agent sessions, terminals) persisted automatically
- Run `.sql` files line-by-line against your database (DataGrip style)

### But not this

- No plugins or themes
- No code completion
- No language servers
- No file indexing

## Inspiration

- WebStorm/IntelliJ which I've been happily using for decades
- VS Code's Claude Code plugin
- Orca which is almost but not quite what I wanted