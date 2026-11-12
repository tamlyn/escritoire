import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveShellEnv } from './shell-env'

test('reads variables set by the login profile, past anything it prints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'escritoire-shell-'))
  await writeFile(
    join(home, '.bash_profile'),
    'echo "welcome {\\"not\\": \\"json\\"}"\nexport FROM_PROFILE=yes\nexport PATH="/opt/profile/bin:$PATH"\n',
  )

  const env = await resolveShellEnv('/bin/bash', process.execPath, {
    HOME: home,
    PATH: '/usr/bin:/bin',
    FROM_LAUNCH: 'kept',
  })

  expect(env.FROM_PROFILE).toBe('yes')
  expect(env.FROM_LAUNCH).toBe('kept')
  // macOS's /etc/profile rewrites PATH too, so only the profile's own change is certain.
  expect(env.PATH?.split(':')[0]).toBe('/opt/profile/bin')
  expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  expect(env.ESCRITOIRE_ENV_SCRIPT).toBeUndefined()
})

test('rejects when the shell does not run the command', async () => {
  await expect(resolveShellEnv('/usr/bin/false', process.execPath, {})).rejects.toThrow('exited with 1')
})
