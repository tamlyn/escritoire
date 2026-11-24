import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One step of a turn `fake-claude.mjs` plays: a block of thinking or text, or a
 * tool call with its result. File paths in a tool's input are relative to the project.
 */
export type ClaudeStep = { thinking: string } | { text: string } | { tool: string; input: Record<string, unknown>; result?: string }

/** The turn played when sent exactly this message. `hold` keeps it working until released. */
export type ClaudeTurn = { steps: ClaudeStep[]; hold?: boolean }
export type ClaudeScript = { turns: Record<string, ClaudeTurn> }

/** The scripted Claude Code in `fake-claude.mjs`, keeping its script in `dir`. */
export function fakeClaude(dir: string, script: ClaudeScript) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'script.json'), JSON.stringify(script))
  return {
    env: { ESCRITOIRE_CLAUDE_CODE_PATH: join(import.meta.dirname, 'fake-claude.mjs'), FAKE_CLAUDE_DIR: dir },
    /** Lets a held turn finish. */
    release: () => writeFileSync(join(dir, 'release'), ''),
  }
}
