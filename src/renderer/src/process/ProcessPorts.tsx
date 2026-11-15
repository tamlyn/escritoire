import type { Port } from '../../../shared/process'

/** Ports that serve HTTP are links, which main opens in the default browser. */
export function ProcessPorts({ ports }: { ports: Port[] }) {
  return ports.map(({ port, url }) =>
    url ? (
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
      <span key={port} title="Not HTTP" className="text-muted-foreground shrink-0 text-xs">
        :{port}
      </span>
    ),
  )
}
