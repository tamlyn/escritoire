# Escritoire

Agentic IDE built with Electron. `PLAN.md` holds the direction, decisions and slice order.

## Commands

- `pnpm dev`: run with hot reload
- `pnpm typecheck`
- `pnpm test`: Vitest unit tests (`src/**/*.test.ts`)
- `pnpm test:e2e`: builds, then drives the real app with Playwright (`e2e/`). Use `launchApp()` from `e2e/app.ts`, which isolates the user data directory.
- `pnpm dist`: packages the app for this machine into `dist/`. The RHEL 8 build comes from GitHub Actions (`.github/workflows/build.yml`), built in an EL8 container; tag `v*` to publish a release.

## Packaging

- Only packages the main process loads at runtime belong in `dependencies`; everything the renderer uses is bundled by Vite and goes in `devDependencies`, so it isn't shipped twice.
- `asar` is off so bundled binaries (Claude Code, later native modules) can be executed and loaded.
- At startup main adopts the environment of an interactive login shell (`src/main/shell-env.ts`), so an app launched from Finder or a desktop launcher gives agents the same PATH and variables as a terminal. The IPC API isn't registered until that has loaded.
- `npmRebuild` is off: `@parcel/watcher` ships N-API prebuilds as per-platform packages (its install script is denied in `pnpm-workspace.yaml`). CI checks the packaged copy loads on EL8.
- `ESCRITOIRE_CLAUDE_CODE_PATH` overrides the Claude Code binary the SDK bundles, for pinning a known-good version on RHEL 8.

## Structure

- `src/main`: Electron main process. Owns all state and side effects (files, persistence, later agents and processes). Keep logic in plain Node modules that can be unit-tested without Electron.
- `src/preload`: exposes `window.api` and nothing else. Must stay CommonJS (sandboxed preload).
- `src/main/agents`: one adapter per agent, translating its stream into the shared session model in `src/shared/agent.ts`. Read `docs/agent-abstraction.md` before changing either.
- `src/main/project-files.ts`: file listing, reading and writing, confined to the project, plus one `@parcel/watcher` subscription on the active project. It drops events for the IDE's own writes (by comparing content), so `filesChanged` means someone else, usually an agent, changed the file; the renderer marks those files for a while.
- `src/shared/api.ts`: the renderer ↔ main contract. Add a method to the `Api` type and the method record, implement it in `src/main/index.ts`, and it becomes `window.api.<method>` over `ipcRenderer.invoke`. Pushes from main go the other way through the `Events` map: main calls `send(name, payload)`, the renderer `subscribe(name, listener)`.
- `src/renderer`: React UI. `ProjectWorkspace` is our wrapper around `react-resizable-panels`' `Workspace`; keep direct use of that library inside it. `components/ui` is shadcn source we own. `components/ai-elements` is AI Elements source adapted to our session model: it must not import the `ai` package. Add further components selectively (AI Elements is moving into the shadcn registry) and fix their imports the same way.

## Gotchas

- Main is an ES module: don't use top-level `await` before the app is ready. Electron delays `ready` until the module finishes evaluating, so it deadlocks.
- The shadcn CLI writes `import { cn } from "cn"` and adds an unrelated `cn` npm package. Fix the import to `@/lib/utils` and remove the package after `shadcn add`.
- pnpm enforces a minimum release age. Pin a slightly older version rather than adding exclusions.
