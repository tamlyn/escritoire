/**
 * A process's output as plain lines for agents: escape sequences removed,
 * progress redraws (carriage returns) collapsed, bounded in size. Errors are
 * collected as they arrive, with stack traces grouped into one entry.
 */
export type LogLine = { at: number; text: string }
export type LogError = { at: number; text: string }

const maxLines = 5000
const maxErrors = 100
const maxErrorLines = 40

// CSI, OSC (ended by BEL or ST) and the remaining two-character escapes.
const escapeSequence = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const incompleteEscape = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/
const errorStart = /\b(?:\w*error|exception|traceback|panic|panicked|fatal|uncaught)\b/i
const continuation = /^\s+\S|^(?:Caused by|During handling|The above exception)/

export class ProcessLog {
  private lines: LogLine[] = []
  private partial = ''
  private errors: LogError[] = []
  private openError: { entry: LogError; lines: number; traceback: boolean } | null = null

  append(chunk: string, now = Date.now()): void {
    // Escape sequences are only removed from complete lines: one can be split across chunks.
    const pieces = (this.partial + chunk).split('\n')
    this.partial = pieces.pop()!
    for (const piece of pieces) this.addLine({ at: now, text: plainText(piece) })
  }

  /** A line the IDE adds, such as a restart marker; never an error. */
  mark(text: string, now = Date.now()): void {
    this.flushPartial(now)
    this.openError = null
    this.addLine({ at: now, text }, false)
  }

  /** The last `count` lines, optionally only those matching `pattern` (case-insensitive). */
  tail(count: number, pattern?: RegExp): LogLine[] {
    const partial = plainText(this.partial.replace(incompleteEscape, ''))
    const lines = partial ? [...this.lines, { at: Date.now(), text: partial }] : this.lines
    const matching = pattern ? lines.filter((line) => pattern.test(line.text)) : lines
    return matching.slice(-count)
  }

  errorsSince(since: number): LogError[] {
    return this.errors.filter((error) => error.at >= since)
  }

  private flushPartial(now: number): void {
    if (this.partial) this.addLine({ at: now, text: plainText(this.partial.replace(incompleteEscape, '')) })
    this.partial = ''
  }

  private addLine(line: LogLine, detectErrors = true): void {
    this.lines.push(line)
    if (this.lines.length > maxLines + 500) this.lines = this.lines.slice(-maxLines)
    if (detectErrors) this.detectError(line)
  }

  private detectError(line: LogLine): void {
    const open = this.openError
    if (open && open.lines < maxErrorLines) {
      if (continuation.test(line.text) || /^\s*at\s/.test(line.text)) {
        this.extendError(open, line.text)
        return
      }
      // A Python traceback ends with an unindented line naming the exception.
      if (open.traceback && line.text.trim()) {
        this.extendError(open, line.text)
        this.openError = null
        return
      }
    }
    this.openError = null
    if (!errorStart.test(line.text)) return
    const entry = { at: line.at, text: line.text }
    this.errors.push(entry)
    if (this.errors.length > maxErrors) this.errors.shift()
    this.openError = { entry, lines: 1, traceback: /^Traceback \(most recent call last\)/.test(line.text) }
  }

  private extendError(open: NonNullable<ProcessLog['openError']>, text: string): void {
    open.entry.text += `\n${text}`
    open.lines++
  }
}

/** What a terminal would show, without colours and once carriage returns have redrawn the line. */
function plainText(line: string): string {
  const segments = line.replace(escapeSequence, '').split('\r')
  for (let i = segments.length - 1; i >= 0; i--) if (segments[i]) return segments[i]!.trimEnd()
  return ''
}
