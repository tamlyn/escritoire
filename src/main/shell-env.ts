import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'

const timeoutMs = 10_000

// An app launched from Finder or a desktop launcher gets a minimal environment,
// without the PATH and variables (a Bedrock proxy, CLAUDE_CONFIG_DIR) that the
// user's shell profile sets up, and agents inherit the app's environment. So the
// app asks an interactive login shell for its environment, as VS Code does. The
// shell starts from the app's own environment, so variables set at launch survive
// unless the profile overrides them.
export async function loadShellEnv(): Promise<void> {
  if (process.platform === 'win32') return
  try {
    Object.assign(process.env, await resolveShellEnv(defaultShell(), process.execPath, process.env))
  } catch (error) {
    console.error('Could not read the login shell environment:', error)
  }
}

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  try {
    return userInfo().shell || '/bin/sh'
  } catch {
    return '/bin/sh'
  }
}

// Prints the environment from a Node child rather than with `env`, so the output
// is unambiguous and the command is the same in POSIX shells and fish. Profiles
// may print to stdout, so the JSON is fenced with a random marker.
export function resolveShellEnv(
  shell: string,
  nodePath: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const marker = randomUUID()
  const ownVars = ['ELECTRON_RUN_AS_NODE', 'ESCRITOIRE_NODE', 'ESCRITOIRE_ENV_SCRIPT']
  // Removes its own variables first: the script itself contains the marker.
  const script = [
    `for (const name of ${JSON.stringify(ownVars)}) delete process.env[name]`,
    `process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(process.env) + ${JSON.stringify(marker)})`,
  ].join(';')

  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-i', '-l', '-c', '"$ESCRITOIRE_NODE" -e "$ESCRITOIRE_ENV_SCRIPT"'], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', ESCRITOIRE_NODE: nodePath, ESCRITOIRE_ENV_SCRIPT: script },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own session, so an interactive shell can't take over a launching terminal.
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${shell} took longer than ${timeoutMs / 1000}s`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const fenced = stdout.split(marker)[1]
      if (fenced === undefined) reject(new Error(`${shell} exited with ${code}: ${stderr.trim()}`))
      else resolve(JSON.parse(fenced) as Record<string, string>)
    })
  })
}
