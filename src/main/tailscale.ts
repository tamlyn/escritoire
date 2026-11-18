import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TailscaleState } from '../shared/remote'

const run = promisify(execFile)
// Tailscale can wait indefinitely for HTTPS to be enabled on the tailnet.
const timeoutMs = 15_000
const macAppCli = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

export type ServeStatus = { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }> }

const proxies = (proxy: string | undefined, port: number) =>
  proxy !== undefined && new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`).test(proxy)

/** The address on the tailnet that serves this local port, if any. */
export function servedUrl(status: ServeStatus, port: number): string | null {
  for (const [host, { Handlers }] of Object.entries(status.Web ?? {})) {
    if (proxies(Handlers?.['/']?.Proxy, port)) return `https://${host.replace(/:443$/, '')}`
  }
  return null
}

/** Something other than these ports of ours, already served at the address publishing would take over. */
export function conflictingTarget(status: ServeStatus, ports: number[]): string | null {
  for (const [host, { Handlers }] of Object.entries(status.Web ?? {})) {
    const handler = Handlers?.['/']
    if (!host.endsWith(':443') || !handler) continue
    if (!ports.some((port) => proxies(handler.Proxy, port))) return handler.Proxy ?? handler.Path ?? handler.Text ?? 'another site'
  }
  return null
}

/** The `tailscale` command, which publishes the remote listener to the tailnet over HTTPS. */
export class TailscaleCli {
  async state(port: number): Promise<TailscaleState> {
    const found = await this.find()
    return { available: found !== null, url: found && servedUrl(found.status, port) }
  }

  /** `previousPort` is where Escritoire last published, which this replaces. */
  async publish(port: number, previousPort: number | null): Promise<TailscaleState> {
    const found = await this.find()
    if (!found) throw new Error("Couldn't run the tailscale command.")
    const conflict = conflictingTarget(found.status, previousPort === null ? [port] : [port, previousPort])
    if (conflict) throw new Error(`Tailscale is already serving ${conflict} here, which publishing would replace.`)
    try {
      await run(found.cli, ['serve', '--bg', String(port)], { timeout: timeoutMs })
    } catch (error) {
      const { stderr, stdout, message } = error as { stderr?: string; stdout?: string; message: string }
      throw new Error(stderr?.trim() || stdout?.trim() || message)
    }
    return this.state(port)
  }

  private async find(): Promise<{ cli: string; status: ServeStatus } | null> {
    const override = process.env.ESCRITOIRE_TAILSCALE_PATH
    for (const cli of override ? [override] : ['tailscale', macAppCli]) {
      try {
        const { stdout } = await run(cli, ['serve', 'status', '--json'], { timeout: timeoutMs })
        return { cli, status: JSON.parse(stdout) as ServeStatus }
      } catch { /* Not installed here, or not running. */ }
    }
    return null
  }
}
