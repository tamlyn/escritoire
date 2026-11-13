/** `stopped` means the IDE stopped it; `failed` is a non-zero exit or a signal from elsewhere. */
export type ProcessStatus = 'running' | 'stopped' | 'exited' | 'failed'

/**
 * A script in a package.json or a task in a mise.toml, which the IDE turns
 * into a command. `file` is relative to the project (absolute is accepted).
 */
export type TaskRef = { file: string; name: string }

/** What to run: a command, or a task, which always becomes the same command. */
export type ProcessSpec = { command: string; cwd?: string } | { task: TaskRef }

export type ProcessInfo = {
  /** Derived from the project, directory and command, so it's stable across restarts. */
  id: string
  projectId: string
  command: string
  /** Relative to the project, '' for its root. */
  cwd: string
  /** Set once it has been started as a task, so run icons can show it running. */
  task: TaskRef | null
  status: ProcessStatus
  exitCode: number | null
  startedAt: number
  endedAt: number | null
}
