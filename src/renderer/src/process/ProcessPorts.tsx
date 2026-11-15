import type { Port } from '../../../shared/process'
import { isDesktop } from '../api'

/**
 * Ports that serve HTTP are links, which main opens in the default browser.
 * They point at this computer's localhost, so another device can't follow them.
 */
export function ProcessPorts({ ports }: { ports: Port[] }) {
  return ports.map(({ port, url }) =>
    url && isDesktop ? (
      <a
        key={port}
        href={url}
        target="_blank"
        rel="noreferrer"
        title={`Open ${url} in the browser`}
        className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-2 hover:underline"
      >
        :{port}
      </a>
    ) : (
      <span key={port} title={url ? undefined : 'Not HTTP'} className="text-muted-foreground shrink-0 text-xs">
        :{port}
      </span>
    ),
  )
}
