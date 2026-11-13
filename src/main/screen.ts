import { SerializeAddon } from '@xterm/addon-serialize'
// CommonJS without detectable named exports.
import xtermHeadless from '@xterm/headless'
import type { ScreenSize, ScreenSnapshot } from '../shared/screen'

const { Terminal } = xtermHeadless

const scrollbackLines = 5000

/**
 * A pty's output, parsed into a headless xterm so a tab can unmount and later
 * redraw from a snapshot. Output is passed on only while a tab is attached.
 */
export class Screen {
  attached = false
  private readonly terminal: InstanceType<typeof Terminal>
  private readonly serializer = new SerializeAddon()
  private seq = 0

  constructor(
    private size: ScreenSize,
    private readonly onOutput: (data: string, seq: number) => void,
  ) {
    this.terminal = new Terminal({ ...size, scrollback: scrollbackLines, allowProposedApi: true })
    this.terminal.loadAddon(this.serializer)
  }

  get currentSize(): ScreenSize {
    return this.size
  }

  write(data: string): void {
    this.terminal.write(data)
    const seq = ++this.seq
    if (this.attached) this.onOutput(data, seq)
  }

  /** Returns whether the size changed, in which case the pty needs resizing too. */
  resize(size: ScreenSize): boolean {
    if (size.cols === this.size.cols && size.rows === this.size.rows) return false
    this.size = size
    this.terminal.resize(size.cols, size.rows)
    return true
  }

  /** Waits for pending output to be parsed, so the snapshot and `seq` agree. */
  snapshot(): Promise<ScreenSnapshot> {
    const seq = this.seq
    return new Promise((resolve) => {
      this.terminal.write('', () => resolve({ data: this.serializer.serialize(), seq }))
    })
  }

  dispose(): void {
    this.terminal.dispose()
  }
}

/** A dim line marking something the IDE did, such as restoring or restarting. */
export function notice(text: string): string {
  return `\r\n\x1b[2m── ${text} ──\x1b[0m\r\n`
}

/** The environment for ptys: the login shell's (see shell-env.ts) plus terminal settings. */
export function ptyEnv(): Record<string, string> {
  return { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
}
