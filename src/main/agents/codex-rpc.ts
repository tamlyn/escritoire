import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } }

/** Newline-delimited JSON-RPC. Closing rejects every outstanding call. */
export class CodexRpc {
  private child
  private nextId = 0
  private pending = new Map<number, { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private closed = false
  private stderr = ''
  onMessage: (message: RpcMessage) => void = () => {}
  onError: (error: Error) => void = () => {}

  constructor(cwd: string) {
    const command = process.env.ESCRITOIRE_CODEX_PATH || 'codex'
    this.child = spawn(command, ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.on('data', (data) => { this.stderr = (this.stderr + String(data)).slice(-4000) })
    this.child.on('error', (error: NodeJS.ErrnoException) => this.fail(error.code === 'ENOENT'
      ? new Error(`Couldn't find the Codex CLI (${command}). Install it, or set ESCRITOIRE_CODEX_PATH to it.`)
      : error))
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('exit', (code, signal) => this.fail(new Error(`Codex exited (${signal ?? code}). ${this.stderr}`)))
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      if (this.closed) return
      try {
        const message = JSON.parse(line) as RpcMessage
        if (!message.method && typeof message.id === 'number') {
          const call = this.pending.get(message.id)
          if (!call) return
          this.pending.delete(message.id)
          clearTimeout(call.timer)
          if (message.error) call.reject(new Error(errorText(call.method, message.error.message)))
          else call.resolve(message.result)
        } else this.onMessage(message)
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  async initialize(): Promise<void> {
    await this.call('initialize', { clientInfo: { name: 'escritoire', title: 'Escritoire', version: '0.0.1' }, capabilities: {} })
    this.write({ method: 'initialized' })
  }

  call<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed'))
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error(`Codex timed out: ${method}`)) }, 120_000)
      this.pending.set(id, { method, resolve: (v) => resolve(v as T), reject, timer })
      this.write({ id, method, params })
    })
  }

  reply(id: number | string, result: unknown): void { this.write({ id, result }) }
  unsupported(id: number | string): void { this.write({ id, error: { code: -32601, message: 'Unsupported client request' } }) }
  private write(message: unknown): void {
    if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n')
  }
  private fail(error: Error): void {
    if (this.closed) return
    this.close(error)
    this.onError(error)
  }
  /** Outstanding calls reject with `reason`. */
  close(reason = new Error('Codex connection closed')): void {
    if (this.closed) return
    this.closed = true
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(reason) }
    this.pending.clear()
    this.child.kill()
  }
}

// An older Codex refuses a method it lacks by listing every method it has.
function errorText(method: string, message: string): string {
  return message.startsWith(`Invalid request: unknown variant \`${method}\``)
    ? `This version of Codex doesn't support ${method}. Update the Codex CLI.`
    : message
}
