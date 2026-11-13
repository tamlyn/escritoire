import { SerializeAddon } from '@xterm/addon-serialize'
// CommonJS without detectable named exports.
import xtermHeadless from '@xterm/headless'
import { type IPty, spawn } from 'node-pty'
import type { ScreenSize, ScreenSnapshot } from '../shared/screen'

const { Terminal } = xtermHeadless

const scrollbackLines = 5000
// xterm throws away input once 50 MB is waiting to be parsed, so a process
// that floods output is paused until the parser catches up. In testing the
// parser kept pace with node-pty's reads, so this is a safeguard.
const pauseAboveChars = 1_000_000
const resumeBelowChars = 100_000

type PtyExit = { exitCode: number; signal?: number }

/**
 * A process running under a pty, with its output parsed into a headless xterm
 * so a tab can unmount and later redraw from a snapshot. Output is passed on
 * only while a tab is attached. Used for terminals and supervised processes.
 */
export class PtyScreen {
  attached = false
  private pty: IPty | null = null
  private paused: IPty | null = null
  private readonly terminal: InstanceType<typeof Terminal>
  private readonly serializer = new SerializeAddon()
  private seq = 0
  private pendingChars = 0
  private disposed = false

  constructor(
    private size: ScreenSize,
    private readonly onOutput: (data: string, seq: number) => void,
  ) {
    this.terminal = new Terminal({ ...size, scrollback: scrollbackLines, allowProposedApi: true })
    this.terminal.loadAddon(this.serializer)
  }

  get running(): boolean {
    return this.pty !== null
  }

  /** The pty's process, which leads its own process group. */
  get pid(): number | undefined {
    return this.pty?.pid
  }

  /**
   * Runs `file` under a new pty and returns its process id. `onExit` isn't
   * called for a pty that was killed, nor once the screen is disposed.
   */
  spawn(file: string, args: string[], cwd: string, onData: (data: string) => void, onExit: (exit: PtyExit) => void): number {
    const pty = spawn(file, args, {
      ...this.size,
      cwd,
      name: 'xterm-256color',
      // The process environment is already the login shell's (see shell-env.ts).
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
    })
    pty.onData((data) => {
      if (this.disposed) return
      this.output(data, pty)
      onData(data)
    })
    pty.onExit((exit) => {
      if (this.pty !== pty || this.disposed) return
      this.pty = null
      onExit(exit)
    })
    this.pty = pty
    return pty.pid
  }

  /** Writes to the screen, not the process: for notices from the IDE. */
  write(data: string): void {
    if (!this.disposed) this.output(data, null)
  }

  /** Input for the process, as typed. */
  input(data: string): void {
    this.pty?.write(data)
  }

  resize(size: ScreenSize): void {
    if (size.cols === this.size.cols && size.rows === this.size.rows) return
    this.size = size
    this.terminal.resize(size.cols, size.rows)
    this.pty?.resize(size.cols, size.rows)
  }

  /** Waits for pending output to be parsed, so the snapshot and `seq` agree. */
  snapshot(): Promise<ScreenSnapshot> {
    const seq = this.seq
    return new Promise((resolve) => {
      this.terminal.write('', () => resolve({ data: this.serializer.serialize(), seq }))
    })
  }

  /** Hangs up the pty, which ends its process group; `onExit` won't be called. */
  kill(): void {
    const pty = this.pty
    this.pty = null
    pty?.kill()
  }

  dispose(): void {
    this.kill()
    this.disposed = true
    this.terminal.dispose()
  }

  private output(data: string, from: IPty | null): void {
    this.pendingChars += data.length
    if (from && this.pendingChars > pauseAboveChars && !this.paused) {
      from.pause()
      this.paused = from
    }
    this.terminal.write(data, () => {
      this.pendingChars -= data.length
      if (this.paused && this.pendingChars < resumeBelowChars) {
        this.paused.resume()
        this.paused = null
      }
    })
    const seq = ++this.seq
    if (this.attached) this.onOutput(data, seq)
  }
}

/** A dim line marking something the IDE did, such as restoring or restarting. */
export function notice(text: string): string {
  return `\r\n\x1b[2m── ${text} ──\x1b[0m\r\n`
}
