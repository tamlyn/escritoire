import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { useParentTabState } from 'react-resizable-panels'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from '../../../shared/screen'
import { subscribe } from '../api'

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
export function ScreenView({ screenId, connection }: { screenId: string; connection: ScreenConnection }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<{ terminal: Terminal; fit: () => void }>(null)
  const visible = useParentTabState()?.isVisible ?? false
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  useEffect(() => {
    const connection = connectionRef.current
    const container = containerRef.current!
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFrom(container),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    // A hidden tab has no size to fit to; it fits when shown.
    const fit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit()
    }
    fit()
    terminalRef.current = { terminal, fit }

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

    terminal.onData(connection.write)
    terminal.onResize(connection.resize)
    const observer = new ResizeObserver(fit)
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe()
      connection.detach()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [screenId])

  useEffect(() => {
    if (!visible) return
    terminalRef.current?.fit()
    terminalRef.current?.terminal.focus()
  }, [visible])

  // Padded outside the container, which the fit addon measures.
  return (
    <div className="h-full px-2 pt-1">
      <div ref={containerRef} className="h-full" />
    </div>
  )
}

/** xterm only understands hex and rgb colours, so the app's oklch tokens are converted. */
function themeFrom(element: HTMLElement): ITheme {
  const style = getComputedStyle(element)
  const token = (name: string) => toRgb(style.getPropertyValue(name))
  return {
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
