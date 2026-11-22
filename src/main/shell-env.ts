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
  // Before the shell starts, which would otherwise pass them on.
  removeLauncherEnv(process.env)
  if (process.platform === 'win32') return
  try {
    Object.assign(process.env, await resolveShellEnv(defaultShell(), process.execPath, process.env))
  } catch (error) {
    console.error('Could not read the login shell environment:', error)
  }
}

// Set for a Claude Code or Codex session and the processes it runs, so they're
// inherited when the app is launched from one (`pnpm dev` run by an agent, or a
// terminal in an IDE that integrates Claude Code). Passed on, they would make the
// app's agents think they're nested in that session, report to its IDE, or take
// its effort level. Adapted from Orca's list: MIT License, Copyright (c) 2026 Lovecast Inc.
const agentSessionVars = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_DESKTOP_APP_VERSION',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_AUTO_CONNECT_IDE',
  'CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_VERSION',
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
  'CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS',
  'CODEX_PLUGIN_METRICS_OUTPUT',
]

// Set by electron-vite for `pnpm dev`. Passed on, they would point an Electron app
// developed in the IDE at the IDE's own dev server, and give agents' builds
// NODE_ENV=development.
const devLauncherVars = [
  'ELECTRON_RENDERER_URL',
  'ELECTRON_CLI_ARGS',
  'ELECTRON_ENTRY',
  'ELECTRON_EXEC_PATH',
  'ELECTRON_MAJOR_VER',
  'NO_SANDBOX',
  'REMOTE_DEBUGGING_PORT',
  'NODE_ENV',
  'NODE_ENV_ELECTRON_VITE',
]

/** Drops what the app inherited from whatever launched it, so agents, terminals and processes don't. */
export function removeLauncherEnv(env: NodeJS.ProcessEnv): void {
  for (const name of agentSessionVars) delete env[name]
  // Otherwise NODE_ENV is the user's own.
  if (env.NODE_ENV_ELECTRON_VITE) for (const name of devLauncherVars) delete env[name]
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
