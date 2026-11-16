<h1 align="center">Escritoire</h1>

<p align="center">
  <img src="docs/images/escritoire.png" alt="Engraving of a writing desk with a fold-out top and many drawers" width="120">
  <br><br>
  You're a writer now. Here is your writing desk.
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
- Project state (tabs, agent sessions, terminals) persisted automatically
- Claude and Codex presented in the same GUI style
- Run `.sql` files line-by-line against your database (DataGrip style)

### And the usual stuff

- Git viewer
- Terminal tabs
- Lightweight editor
- Light and dark modes
- Use your existing Claude and Codex subscription

### But not this

- No plugins or themes
- No code completion
- No language servers
- No file indexing

## Running it

You'll need Node, pnpm and, for Codex, the `codex` CLI installed and logged in.

```sh
pnpm install
pnpm dev
```

`pnpm dist` packages the app for your machine into `dist/`. Linux builds come from GitHub Actions.

## Releases

Release versions use `YYYY.M.D`, without leading zeros (for example, `2026.11.16`).
After committing the changes to release, create today's tag and push it:

```sh
git push origin main
pnpm release
git push origin v2026.11.16
```

`pnpm release` (or `npm run release`) tags the current commit using your local date
and prints the push command; it does not push or change `package.json`. Use the
printed tag in place of the example. Each date supports one release; the script
fails if today's tag already exists. Published tags should stay fixed.

The tag triggers GitHub Actions to run type checks and tests, build the Linux x64
tarball, and publish it on GitHub Releases. CI takes the app version from the tag;
no version bump commit is needed. Pushes to `main` and manual workflow runs build
downloadable artifacts without publishing a release.
