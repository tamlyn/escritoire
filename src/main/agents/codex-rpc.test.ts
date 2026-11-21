import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexRpc } from './codex-rpc'

/** Runs `codex app-server` as a script that answers each request with `answer`. */
async function fakeCodex(answer: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'escritoire-codex-'))
  const path = join(dir, 'codex')
  await writeFile(path, `#!/usr/bin/env node
const lines = require('node:readline').createInterface({ input: process.stdin })
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  ${answer}
})
`)
  await chmod(path, 0o755)
  process.env.ESCRITOIRE_CODEX_PATH = path
}

afterEach(() => { delete process.env.ESCRITOIRE_CODEX_PATH })

describe('CodexRpc', () => {
  it('names a method this version of Codex lacks, rather than listing every one it has', async () => {
    await fakeCodex(`
      if (request.method === 'initialize') send({ id: request.id, result: {} })
      else send({ id: request.id, error: { code: -32600, message: 'Invalid request: unknown variant \`' + request.method + '\`, expected one of \`initialize\`, \`thread/start\`' } })
    `)
    const rpc = new CodexRpc(tmpdir())
    await rpc.initialize()
    await expect(rpc.call('thread/turns/list', {})).rejects.toThrow(
      /^This version of Codex doesn't support thread\/turns\/list\. Update the Codex CLI\.$/,
    )
    rpc.close()
  })
})
