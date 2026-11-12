# Escritoire

Agentic IDE built with Electron. `PLAN.md` holds the direction, decisions and slice order.

## Commands

- `pnpm dev`: run with hot reload
- `pnpm typecheck`
- `pnpm test`: Vitest unit tests (`src/**/*.test.ts`)
- `pnpm test:e2e`: builds, then drives the real app with Playwright (`e2e/`). Use `launchApp()` from `e2e/app.ts`, which isolates the user data directory.

## Structure

- `src/main`: Electron main process. Owns all state and side effects (files, persistence, later agents and processes). Keep logic in plain Node modules that can be unit-tested without Electron.
- `src/preload`: exposes `window.api` and nothing else. Must stay CommonJS (sandboxed preload).
- `src/shared/api.ts`: the renderer ↔ main contract. Add a method to the `Api` type and the method record, implement it in `src/main/index.ts`, and it becomes `window.api.<method>` over `ipcRenderer.invoke`.
- `src/renderer`: React UI. `ProjectWorkspace` is our wrapper around `react-resizable-panels`' `Workspace`; keep direct use of that library inside it. `components/ui` is shadcn source we own.

## Gotchas

- Main is an ES module: don't use top-level `await` before the app is ready. Electron delays `ready` until the module finishes evaluating, so it deadlocks.
- The shadcn CLI writes `import { cn } from "cn"` and adds an unrelated `cn` npm package. Fix the import to `@/lib/utils` and remove the package after `shadcn add`.
- pnpm enforces a minimum release age. Pin a slightly older version rather than adding exclusions.
