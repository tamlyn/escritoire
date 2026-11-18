#!/usr/bin/env node
// Stands in for the `tailscale` command, so tests never touch a real tailnet.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const file = process.env.FAKE_TAILSCALE_STATE
const args = process.argv.slice(2)
if (args[1] === 'status') {
  console.log(existsSync(file) ? readFileSync(file, 'utf8') : '{}')
} else {
  const port = args.at(-1)
  writeFileSync(file, JSON.stringify({ Web: { 'phone-test.example.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } }))
}
