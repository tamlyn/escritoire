import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ProcessInfo } from '../shared/process'
import type { Supervisor } from './supervisor'

/** Tools that only read, which agents may use without asking. */
export const readOnlyTools = ['list_processes', 'read_output', 'recent_errors']

// Long enough to see a process fail on start, short enough not to stall the agent.
const settleMs = 1500

/**
 * The supervisor as MCP tools, scoped to one project. The user sees the same
 * processes in the IDE, so these are how agents and the user share them.
 */
export function registerSupervisorTools(server: McpServer, supervisor: Supervisor, projectId: string): void {
  server.registerTool(
    'list_processes',
    {
      description:
        'List the processes the IDE supervises in this project (dev servers, watchers, builds), with their status. ' +
        'Check this before starting a process: it may already be running.',
      annotations: { readOnlyHint: true },
    },
    async () => text(supervisor.list(projectId).map(describe).join('\n\n') || 'No processes.'),
  )

  server.registerTool(
    'start_process',
    {
      description:
        'Start a long-running or background process (dev server, watcher, build) under the IDE, where the user can ' +
        'see and control it. Use this instead of running commands in the background. If the same command is already ' +
        'running in the same directory, returns that process instead of starting another. Give either `command` ' +
        '(run with /bin/sh, `cwd` relative to the project root or absolute, and may be outside the project) or `task`, a script in a package.json or ' +
        'a task in a mise.toml, which runs as the same command the user gets from the run icon in that file.',
      inputSchema: {
        command: z.string().optional(),
        cwd: z.string().optional().describe('Directory to run `command` in; defaults to the project root.'),
        task: z
          .object({
            file: z.string().describe('The package.json or mise.toml, relative to the project root or absolute.'),
            name: z.string().describe('The script or task name.'),
          })
          .optional(),
      },
    },
    async ({ command, cwd, task }) => {
      if (Boolean(command) === Boolean(task)) return error('Give exactly one of `command` or `task`.')
      const { process, alreadyRunning } = await supervisor.start(projectId, task ? { task } : { command: command!, cwd })
      if (alreadyRunning) return text(`Already running, so not started again.\n\n${describe(process)}`)
      await settle(supervisor, projectId, process.id)
      return text(`Started.\n\n${describeWithOutput(supervisor, projectId, process.id)}`)
    },
  )

  server.registerTool(
    'stop_process',
    { description: 'Stop a supervised process and everything it started.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      await supervisor.stop(projectId, id)
      return text(describe(current(supervisor, projectId, id)))
    },
  )

  server.registerTool(
    'restart_process',
    { description: 'Restart a supervised process, or start it again if it has ended.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      await supervisor.restart(projectId, id)
      await settle(supervisor, projectId, id)
      return text(describeWithOutput(supervisor, projectId, id))
    },
  )

  server.registerTool(
    'read_output',
    {
      description:
        "Read a supervised process's recent output, as plain text with progress redraws collapsed. Optionally only " +
        'lines matching a regular expression (case-insensitive).',
      inputSchema: {
        id: z.string(),
        lines: z.number().int().min(1).max(2000).default(100).describe('How many of the latest lines to return.'),
        grep: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, lines, grep }) => {
      let pattern: RegExp | undefined
      try {
        pattern = grep ? new RegExp(grep, 'i') : undefined
      } catch (e) {
        return error(`Invalid regular expression: ${(e as Error).message}`)
      }
      const output = supervisor.output(projectId, id, lines, pattern)
      return text(output.map((line) => line.text).join('\n') || '(no output)')
    },
  )

  server.registerTool(
    'recent_errors',
    {
      description:
        "Errors and stack traces from all of this project's supervised processes, oldest first, each with the " +
        'process it came from. A quick way to see whether anything in the stack is failing.',
      inputSchema: { minutes: z.number().min(1).max(24 * 60).default(15).describe('How far back to look.') },
      annotations: { readOnlyHint: true },
    },
    async ({ minutes }) => {
      const errors = supervisor.errorsSince(projectId, Date.now() - minutes * 60_000)
      const entries = errors.map((e) => `[${time(e.at)}] ${e.command} (${e.processId})\n${e.text}`)
      return text(entries.join('\n\n') || `No errors in the last ${minutes} minutes.`)
    },
  )
}

function describe(process: ProcessInfo): string {
  const status =
    process.status === 'running'
      ? `running since ${time(process.startedAt)}`
      : `${process.status} at ${time(process.endedAt!)}${process.exitCode === null ? '' : ` with exit code ${process.exitCode}`}`
  return [`id: ${process.id}`, `command: ${process.command}`, `cwd: ${process.cwd || '.'}`, `status: ${status}`].join('\n')
}

function describeWithOutput(supervisor: Supervisor, projectId: string, id: string): string {
  const output = supervisor.output(projectId, id, 20).map((line) => line.text)
  return `${describe(current(supervisor, projectId, id))}\n\nOutput so far:\n${output.join('\n') || '(none)'}`
}

function current(supervisor: Supervisor, projectId: string, id: string): ProcessInfo {
  return supervisor.list(projectId).find((p) => p.id === id)!
}

/** Waits briefly, or until the process ends, so the reply shows how it started. */
async function settle(supervisor: Supervisor, projectId: string, id: string): Promise<void> {
  const deadline = Date.now() + settleMs
  while (Date.now() < deadline && current(supervisor, projectId, id)?.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString()
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

function error(content: string) {
  return { ...text(content), isError: true }
}
