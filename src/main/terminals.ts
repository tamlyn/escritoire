import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from '../shared/screen'
import { deleteJson, readJson, writeJson } from './json-file'
import { notice, PtyScreen } from './screen'

/** What's kept of a terminal between a project closing and reopening. */
type SavedTerminal = { cwd: string; scrollback: string }
type ProjectTerminals = Record<string, SavedTerminal>

type TerminalsOptions = {
  dataDir: string
  projectPath: (projectId: string) => string
  send: (output: ScreenOutput) => void
}

/**
 * Interactive shells, one per terminal tab, keyed by tab id. Scrollback and
 * working directory are saved when the project closes, for the tab to restore.
 */
export class Terminals {
  private readonly terminals = new Map<string, ShellTerminal>()
  private readonly saved = new Map<string, Promise<ProjectTerminals>>()

  constructor(private readonly options: TerminalsOptions) {}

  /**
   * Starts the terminal's shell if it isn't running, restoring saved
   * scrollback and directory, and sends its output until detached.
   */
  async attach(projectId: string, terminalId: string, size: ScreenSize): Promise<ScreenSnapshot> {
    let terminal = this.terminals.get(terminalId)
    if (!terminal) {
      const saved = await this.takeSaved(projectId, terminalId)
      // Attaching twice at once would otherwise start two shells.
      terminal = this.terminals.get(terminalId)
      if (!terminal) {
        terminal = new ShellTerminal(projectId, size, saved?.scrollback, (data, seq) =>
          this.options.send({ screenId: terminalId, data, seq }),
        )
        terminal.start(saved?.cwd ?? this.options.projectPath(projectId))
        this.terminals.set(terminalId, terminal)
      }
    }
    terminal.screen.resize(size)
    terminal.screen.attached = true
    return terminal.screen.snapshot()
  }

  detach(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) terminal.screen.attached = false
  }

  /** Typing into a terminal whose shell has exited starts a new one. */
  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return
    if (terminal.screen.running) terminal.screen.input(data)
    else terminal.start(this.options.projectPath(terminal.projectId))
  }

  resize(terminalId: string, size: ScreenSize): void {
    this.terminals.get(terminalId)?.screen.resize(size)
  }

  /** Stops the shell and forgets the terminal, as when its tab is closed. */
  async close(projectId: string, terminalId: string): Promise<void> {
    this.terminals.get(terminalId)?.screen.dispose()
    this.terminals.delete(terminalId)
    await this.takeSaved(projectId, terminalId)
  }

  /** Stops the project's shells, saving each one's scrollback and directory for its tab to restore. */
  async closeProject(projectId: string): Promise<void> {
    const closing = [...this.terminals].filter(([, terminal]) => terminal.projectId === projectId)
    if (closing.length === 0) return
    const saved = await this.loadSaved(projectId)
    for (const [terminalId, terminal] of closing) {
      this.terminals.delete(terminalId)
      saved[terminalId] = await terminal.save(this.options.projectPath(projectId))
      terminal.screen.dispose()
    }
    await writeJson(this.path(projectId), saved)
  }

  async deleteProject(projectId: string): Promise<void> {
    for (const [terminalId, terminal] of this.terminals) {
      if (terminal.projectId !== projectId) continue
      terminal.screen.dispose()
      this.terminals.delete(terminalId)
    }
    this.saved.delete(projectId)
    await deleteJson(this.path(projectId))
  }

  async closeAll(): Promise<void> {
    const projectIds = new Set([...this.terminals.values()].map((t) => t.projectId))
    await Promise.all([...projectIds].map((projectId) => this.closeProject(projectId)))
  }

  /** Saved state is used once: a running terminal is saved again when it closes. */
  private async takeSaved(projectId: string, terminalId: string): Promise<SavedTerminal | undefined> {
    const saved = await this.loadSaved(projectId)
    const terminal = saved[terminalId]
    if (!terminal) return undefined
    delete saved[terminalId]
    await writeJson(this.path(projectId), saved)
    return terminal
  }

  private loadSaved(projectId: string): Promise<ProjectTerminals> {
    let saved = this.saved.get(projectId)
    if (!saved) {
      // Unreadable saved state only costs the scrollback, so it mustn't stop terminals working.
      saved = readJson(this.path(projectId)).then(
        (value) => (value as ProjectTerminals) ?? {},
        (error: unknown) => {
          console.error(error)
          return {}
        },
      )
      this.saved.set(projectId, saved)
    }
    return saved
  }

  private path(projectId: string): string {
    return join(this.options.dataDir, 'terminals', `${projectId}.json`)
  }
}

class ShellTerminal {
  readonly screen: PtyScreen

  constructor(
    readonly projectId: string,
    size: ScreenSize,
    restoredScrollback: string | undefined,
    onOutput: (data: string, seq: number) => void,
  ) {
    this.screen = new PtyScreen(size, onOutput)
    if (restoredScrollback) {
      this.screen.write(restoredScrollback)
      this.screen.write(`${notice(`Restored ${new Date().toLocaleString()}`)}\r\n`)
    }
  }

  start(cwd: string): void {
    const shell = process.env.SHELL || userInfo().shell || '/bin/sh'
    this.screen.spawn(shell, [], cwd, () => {}, () => {
      this.screen.write(notice('Shell exited. Press any key to start a new one.'))
    })
  }

  async save(fallbackCwd: string): Promise<SavedTerminal> {
    const pid = this.screen.pid
    const cwd = (pid && (await workingDirectory(pid))) || fallbackCwd
    return { cwd, scrollback: (await this.screen.snapshot()).data }
  }
}

const execFileAsync = promisify(execFile)

async function workingDirectory(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === 'linux') return await readlink(`/proc/${pid}/cwd`)
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    return stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1)
  } catch {
    return undefined
  }
}
