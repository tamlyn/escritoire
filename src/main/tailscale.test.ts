import { expect, it } from 'vitest'
import { conflictingTarget, type ServeStatus, servedUrl } from './tailscale'

const serving = (proxy: string, host = 'mac.tailnet.ts.net:443'): ServeStatus => ({ Web: { [host]: { Handlers: { '/': { Proxy: proxy } } } } })

it('finds the address serving the port', () => {
  expect(servedUrl(serving('http://127.0.0.1:4729'), 4729)).toBe('https://mac.tailnet.ts.net')
  expect(servedUrl(serving('http://localhost:4729', 'mac.tailnet.ts.net:8443'), 4729)).toBe('https://mac.tailnet.ts.net:8443')
})

it('finds no address when the port is not served', () => {
  expect(servedUrl({}, 4729)).toBeNull()
  expect(servedUrl(serving('http://127.0.0.1:47290'), 4729)).toBeNull()
})

it('notices another service at the address publishing would take over', () => {
  expect(conflictingTarget(serving('http://127.0.0.1:3000'), 4729)).toBe('http://127.0.0.1:3000')
  expect(conflictingTarget(serving('http://127.0.0.1:4729'), 4729)).toBeNull()
  expect(conflictingTarget(serving('http://127.0.0.1:3000', 'mac.tailnet.ts.net:8443'), 4729)).toBeNull()
  expect(conflictingTarget({}, 4729)).toBeNull()
})
