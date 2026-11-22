import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal } from '@xterm/xterm'
import { type RefObject, useEffect, useRef } from 'react'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from '../../../shared/screen'
import { subscribe } from '../api'
import { isCommandKey } from '../commands'
import { codeFontSize, codeLineHeight } from '../lib/code-font'

export type ScreenConnection = {
  /** Sends `screenOutput` for this screen from now on, and returns what's on it so far. */
  attach: (size: ScreenSize) => Promise<ScreenSnapshot>
  detach: () => void
  write: (data: string) => void
  resize: (size: ScreenSize) => void
}

/**
 * Draws a pty that runs in main, which keeps the screen. Each mount starts
 * from main's snapshot, so unmounting (switching projects) loses nothing.
 * `connection` is read once per `screenId`.
 */
export function ScreenView({ screenId, connection, autoFocus = false, terminalRef: givenRef }: {
  screenId: string
  connection: ScreenConnection
  autoFocus?: boolean
  /** Set to the terminal while it exists. */
  terminalRef?: RefObject<Terminal | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<Terminal>(null)
  const terminalRef = givenRef ?? ownRef
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  useEffect(() => {
    const connection = connectionRef.current
    const container = containerRef.current!
    const fontFamily = getComputedStyle(container).getPropertyValue('--font-mono')
    const terminal = new Terminal({
      fontFamily,
      fontSize: codeFontSize,
      lineHeight: lineHeightFor(container, fontFamily),
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFrom(container),
    })
    // On Linux the app's Ctrl+Shift shortcuts would otherwise go to the shell.
    terminal.attachCustomKeyEventHandler((event) => !isCommandKey(event))
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    // A hidden tab has no size to fit to; it fits when shown.
    const fit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit()
    }
    fit()
    terminalRef.current = terminal

    // Output can arrive before the snapshot; anything the snapshot includes is dropped.
    let snapshotSeq: number | null = null
    const early: ScreenOutput[] = []
    const unsubscribe = subscribe('screenOutput', (output) => {
      if (output.screenId !== screenId) return
      if (snapshotSeq === null) early.push(output)
      else if (output.seq > snapshotSeq) terminal.write(output.data)
    })
    let disposed = false
    void connection.attach({ cols: terminal.cols, rows: terminal.rows }).then((snapshot) => {
      if (disposed) return
      terminal.write(snapshot.data)
      snapshotSeq = snapshot.seq
      for (const output of early) if (output.seq > snapshot.seq) terminal.write(output.data)
    })

    // xterm's scrollbar only stays visible while hovered, unlike the native ones; styles.css shows it while there's scrollback.
    const updateScrollable = () => container.toggleAttribute('data-scrollable', terminal.buffer.active.baseY > 0)
    terminal.onWriteParsed(updateScrollable)
    terminal.onResize(updateScrollable)
    terminal.buffer.onBufferChange(updateScrollable)

    terminal.onData(connection.write)
    terminal.onResize(connection.resize)
    // xterm pauses rendering while hidden, and a resize then leaves its scrollbar at the old height,
    // overflowing the tab. Its own observer was created first, so it has resumed by the time this one fires.
    let shown = false
    const visibility = new IntersectionObserver((entries) => {
      shown = entries.at(-1)!.isIntersecting
      if (shown) fit()
    })
    visibility.observe(container)
    const resize = new ResizeObserver(() => {
      if (shown) fit()
    })
    resize.observe(container)

    const colorScheme = matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = () => (terminal.options.theme = themeFrom(container))
    colorScheme.addEventListener('change', updateTheme)

    return () => {
      disposed = true
      visibility.disconnect()
      resize.disconnect()
      colorScheme.removeEventListener('change', updateTheme)
      unsubscribe()
      connection.detach()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [screenId])

  useEffect(() => {
    if (autoFocus) terminalRef.current?.focus()
  }, [autoFocus])

  // Padded outside the container, which the fit addon measures. Clipped because xterm's
  // input textarea follows the cursor and keeps its place after a resize, so it can be left
  // below the terminal, making the whole tab scroll.
  return (
    <div className="h-full p-2">
      <div ref={containerRef} className="h-full overflow-clip" />
    </div>
  )
}

/** xterm's line height is a multiple of the font's own, so it's derived from that to come out at `codeLineHeight`. */
function lineHeightFor(container: HTMLElement, fontFamily: string): number {
  const probe = document.createElement('span')
  probe.style.font = `${codeFontSize}px ${fontFamily}`
  probe.textContent = 'W'
  container.append(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return codeLineHeight / height
}

/** xterm only understands hex and rgb colours, so the app's oklch tokens are converted. */
function themeFrom(element: HTMLElement): ITheme {
  const style = getComputedStyle(element)
  const token = (name: string) => toRgb(style.getPropertyValue(name))
  const scrollbarThumb = token('--scrollbar-thumb')
  return {
    scrollbarSliderBackground: scrollbarThumb,
    scrollbarSliderHoverBackground: scrollbarThumb,
    scrollbarSliderActiveBackground: scrollbarThumb,
    background: token('--background'),
    foreground: token('--foreground'),
    cursor: token('--foreground'),
    selectionBackground: toRgb(`color-mix(in oklch, ${style.getPropertyValue('--ring')} 45%, transparent)`),
  }
}

const canvas = document.createElement('canvas')
canvas.width = canvas.height = 1
const context = canvas.getContext('2d', { willReadFrequently: true })!

function toRgb(color: string): string {
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(2)})`
}
