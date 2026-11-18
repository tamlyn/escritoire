# Escritoire

Agentic IDE built with Electron. `HISTORY.md` holds the decisions, tech stack and requirements of what's built; `PLAN.md` holds what's still to build and in what order. When a feature is built, move its requirements from the plan to the history.

## Commands

- `pnpm dev`: run with hot reload
- `pnpm typecheck`
- `pnpm release`: create a local `vYYYY.M.D` tag at HEAD using today's local date; does not push.
- `pnpm test`: Vitest unit tests (`src/**/*.test.ts`)
- `pnpm test:e2e`: builds, then drives the real app with Playwright (`e2e/`). Use `launchApp()` from `e2e/app.ts`, which isolates the user data directory. The remote access tests also drive Chromium and WebKit, so after Playwright updates run `npx playwright install chromium webkit`. Don't type into the app's windows while the tests run.
- `pnpm dist`: packages the app for this machine into `dist/`. The RHEL 8 build comes from GitHub Actions (`.github/workflows/build.yml`), built in an EL8 container; push a `vYYYY.M.D` tag (no leading zeros) to publish a release. CI sets the app version from the tag.

## Packaging

- Only packages the main process loads at runtime belong in `dependencies`; everything the renderer uses is bundled by Vite and goes in `devDependencies`, so it isn't shipped twice.
- `asar` is off so bundled binaries (Claude Code, later native modules) can be executed and loaded.
- At startup main adopts the environment of an interactive login shell (`src/main/shell-env.ts`), so an app launched from Finder or a desktop launcher gives agents the same PATH and variables as a terminal. The API server doesn't start until that has loaded.
- `npmRebuild` is off: the native modules ship N-API prebuilds, so nothing is compiled (their install scripts are denied in `pnpm-workspace.yaml`). `@parcel/watcher` has per-platform packages; `node-pty` is pinned to a 1.2 beta because 1.1.0 lacks Linux prebuilds and its macOS `spawn-helper` isn't executable. CI checks both load on EL8.
- `ESCRITOIRE_CODEX_PATH` overrides the installed `codex` executable used for native app-server sessions. Codex reuses its existing login and config.
- `ESCRITOIRE_CLAUDE_CODE_PATH` overrides the Claude Code binary the SDK bundles, for pinning a known-good version on RHEL 8.

## Structure

- `src/main`: Electron main process. Owns all state and side effects (files, persistence, later agents and processes). Keep logic in plain Node modules that can be unit-tested without Electron.
- `src/preload`: exposes `window.desktop`, which tells the window where the API is and its token, and nothing else. Keep it to what only the desktop can do. Must stay CommonJS (sandboxed preload).
- `src/main/agents`: one adapter per agent, translating its stream into the shared session model in `src/shared/agent.ts`. Read `docs/agent-abstraction.md` before changing either.
- `src/main/project-files.ts`: file listing, reading and writing. Changes to the tree are confined to the project; reading and writing a file isn't, so links to files elsewhere open. Plus a `@parcel/watcher` subscription on each project that is some client's active one. It drops events for the IDE's own writes (by comparing content), so `filesChanged` means someone else, usually an agent, changed the file, and an editor reloading it never races its own autosave. A file opened from outside the project has its directory watched until the project is no longer watched.
- `src/main/screen.ts`: a pty's output mirrored in a headless xterm, so terminal and process tabs can unmount and redraw from a snapshot. `src/renderer/src/screen/ScreenView.tsx` draws one.
- `src/main/terminals.ts`: one shell per terminal tab, keyed by tab id. Saves scrollback and working directory when a project closes or the app quits.
- `src/main/supervisor.ts`: project processes, owned by the IDE rather than tabs or agents. One per project, directory and command (the id is derived from them); a task (package.json script, mise task) always becomes the same command, so the user's run icon and an agent's command find the same process. Each runs under a pty, whose hangup stops it if the app dies. `process-log.ts` keeps plain-text output and grouped errors for agents.
- `src/main/ide-server.ts` and `ide-tools.ts`: the IDE's MCP server on 127.0.0.1, token-protected, one URL per project, given to every session the IDE starts. Claude's background Bash calls are refused in favour of its `start_process` tool (`agents/claude.ts`).
- `src/main/git.ts`: the git summary, history, commits, diffs and blame, plus switch, pull and push, from the `git` CLI, scoped to the project (which may be a subdirectory of a repository). Git runs without optional locks, so refreshing never writes to the index. `gitChanged` is only a hint: it fires for any change in a watched project's files (including the IDE's own writes) or its git directory, and the renderer reloads what it shows (`renderer/src/git/git.ts`). Blame is of the editor's text (`--contents -`), so it stays aligned while editing. The history graph's lane layout is `renderer/src/git/graph.ts`.
- `src/main/sql/`: SQL connections and runs. `connection-store.ts` keeps each project's connections (never passwords) and which one each file uses; `databases.ts` keeps one open connection per saved connection. `pgpass.ts` reads and writes `~/.pgpass`, the only place a password is kept. SQLite runs in a child process (`sqlite-child.ts`, bundled through electron-vite's `?modulePath`), since `node:sqlite` blocks and can't be interrupted. The renderer finds the statements to run with `splitStatements` in `src/shared/sql.ts`.
- `src/shared/api.ts`: the client ↔ main contract. Add a method to the `Api` type and the method record, implement it in `src/main/index.ts`, and it becomes `api.<method>` in the renderer (`renderer/src/api.ts`). Pushes from main go the other way through the `Events` map: main calls `send(name, payload)`, the renderer `subscribe(name, listener)`.
- `src/main/api-server.ts` and `src/shared/api-client.ts`: that contract over a WebSocket on 127.0.0.1, for every client including the desktop window (not Electron IPC). Values travel as JSON, so they must survive it: `null`, never `undefined`, for a value that means something. `api-client.ts` fails to compile if a method or event can't. The desktop's token is random per launch and never stored.
- `src/main/clients.ts`: each connection's own state (active project, open session views and their visibility, attached screens and their sizes, presence), combined into what the services see: a session is visible if any present client shows it, a screen attached while any client is. It routes session events and screen output only to the clients showing them, and releases a client's state when it disconnects. `createApi` in `src/main/index.ts` builds the API for one client. `presence.ts` says whether the user is at the desktop.
- `src/main/remote-access.ts`: remote access from a paired browser: its own listener on a fixed port for `tailscale serve`, serving the renderer (`static-files.ts`), pairing and the API, plus the paired devices (token hashes only). The renderer tells the desktop from a browser with `isDesktop` (`renderer/src/api.ts`); a browser that hasn't paired shows `remote/Pairing.tsx`.
- `src/renderer`: React UI. `ProjectWorkspace` is our wrapper around `react-resizable-panels`' `Workspace`: render `Workspace` and its layout model only there. Tab content may use the library's `useParent*` hooks. `components/ui` is shadcn source we own. `components/ai-elements` is AI Elements source adapted to our session model: it must not import the `ai` package. Add further components selectively (AI Elements is moving into the shadcn registry) and fix their imports the same way.

## Gotchas

- Main is an ES module: don't use top-level `await` before the app is ready. Electron delays `ready` until the module finishes evaluating, so it deadlocks.
- The shadcn CLI writes `import { cn } from "cn"` and adds an unrelated `cn` npm package. Fix the import to `@/lib/utils` and remove the package after `shadcn add`.
- pnpm enforces a minimum release age. Pin a slightly older version rather than adding exclusions.
- Shells started from VS Code inherit `ELECTRON_RUN_AS_NODE=1`, which makes Electron refuse Playwright's flags ("bad option: --remote-debugging-port"). Run e2e tests with `env -u ELECTRON_RUN_AS_NODE`.

