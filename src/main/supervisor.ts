import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ProcessInfo, ProcessSpec, TaskRef } from '../shared/process'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from '../shared/screen'
import { type LogError, type LogLine, ProcessLog } from './process-log'
import { notice, PtyScreen } from './screen'
import { taskCommand } from './tasks'

const stopGraceMs = 5000
const defaultSize: ScreenSize = { cols: 120, rows: 30 }

type SupervisorOptions = {
  projectPath: (projectId: string) => string
  send: (output: ScreenOutput) => void
  onChanged: (processes: ProcessInfo[]) => void
}

export type ProcessError = LogError & { processId: string; command: string }

/**
 * Project processes, owned by the IDE rather than by a tab or an agent. There
 * is one process per project, directory and command; starting one that's
 * running returns it. Each runs under a pty, so it behaves as in a terminal,
 * and if the app dies the pty's hangup stops it.
 */
export class Supervisor {
  private readonly processes = new Map<string, SupervisedProcess>()

  constructor(private readonly options: SupervisorOptions) {}

  list(projectId?: string): ProcessInfo[] {
    return [...this.processes.values()]
      .filter((p) => projectId === undefined || p.info.projectId === projectId)
      .map((p) => ({ ...p.info }))
  }

  async start(projectId: string, spec: ProcessSpec): Promise<{ process: ProcessInfo; alreadyRunning: boolean }> {
    const { command, cwd, absoluteCwd, task } = await this.resolve(projectId, spec)
    const id = processId(projectId, cwd, command)
    // Synchronous from here on, so concurrent starts can't both create it.
    let supervised = this.processes.get(id)
    const alreadyRunning = supervised?.running ?? false
    if (!supervised) {
      supervised = new SupervisedProcess(
        { id, projectId, command, cwd, task, status: 'running', exitCode: null, startedAt: 0, endedAt: null },
        absoluteCwd,
        (data, seq) => this.options.send({ screenId: id, data, seq }),
        () => this.changed(),
      )
      this.processes.set(id, supervised)
    }
    if (task) supervised.info.task = task
    if (!alreadyRunning) supervised.start()
    this.changed()
    return { process: { ...supervised.info }, alreadyRunning }
  }

  async stop(projectId: string, id: string): Promise<void> {
    await this.get(projectId, id).stop()
  }

  async restart(projectId: string, id: string): Promise<ProcessInfo> {
    const supervised = this.get(projectId, id)
    await supervised.stop()
    if (!supervised.running) supervised.start()
    this.changed()
    return { ...supervised.info }
  }

  /** Forgets a process that has ended, with its output. */
  remove(projectId: string, id: string): void {
    const supervised = this.get(projectId, id)
    if (supervised.running) throw new Error('Stop the process before removing it.')
    supervised.screen.dispose()
    this.processes.delete(id)
    this.changed()
  }

  attach(projectId: string, id: string, size: ScreenSize): Promise<ScreenSnapshot> {
    const supervised = this.get(projectId, id)
    supervised.screen.resize(size)
    supervised.screen.attached = true
    return supervised.screen.snapshot()
  }

  detach(id: string): void {
    const supervised = this.processes.get(id)
    if (supervised) supervised.screen.attached = false
  }

  write(projectId: string, id: string, data: string): void {
    this.get(projectId, id).screen.input(data)
  }

  resize(projectId: string, id: string, size: ScreenSize): void {
    this.get(projectId, id).screen.resize(size)
  }

  output(projectId: string, id: string, count: number, pattern?: RegExp): LogLine[] {
    return this.get(projectId, id).log.tail(count, pattern)
  }

  errorsSince(projectId: string, since: number): ProcessError[] {
    return [...this.processes.values()]
      .filter((p) => p.info.projectId === projectId)
      .flatMap((p) => p.log.errorsSince(since).map((e) => ({ ...e, processId: p.info.id, command: p.info.command })))
      .sort((a, b) => a.at - b.at)
  }

  /** Stops and forgets the project's processes. */
  async closeProject(projectId: string): Promise<void> {
    const closing = [...this.processes.values()].filter((p) => p.info.projectId === projectId)
    await Promise.all(closing.map((p) => p.stop()))
    for (const p of closing) {
      p.screen.dispose()
      this.processes.delete(p.info.id)
    }
    if (closing.length > 0) this.changed()
  }

  async closeAll(): Promise<void> {
    const projectIds = new Set([...this.processes.values()].map((p) => p.info.projectId))
    await Promise.all([...projectIds].map((projectId) => this.closeProject(projectId)))
  }

  private get(projectId: string, id: string): SupervisedProcess {
    const supervised = this.processes.get(id)
    if (!supervised || supervised.info.projectId !== projectId) throw new Error(`No process ${id} in this project.`)
    return supervised
  }

  private async resolve(projectId: string, spec: ProcessSpec) {
    const root = await realpath(this.options.projectPath(projectId))
    let command: string
    let directory: string
    let task: TaskRef | null = null
    if ('task' in spec) {
      const file = await realpath(resolve(root, spec.task.file))
      task = { file: display(root, file), name: spec.task.name }
      ;({ command, cwd: directory } = await taskCommand(root, { file, name: task.name }))
    } else {
      command = spec.command.trim()
      if (!command) throw new Error('The command is empty.')
      directory = resolve(root, spec.cwd ?? '.')
    }
    // Processes may run anywhere (serving a scratch project in /tmp, say); they
    // still belong to the project whose user or agent started them.
    const absoluteCwd = await realpath(directory)
    return { command, cwd: display(root, absoluteCwd), absoluteCwd, task }
  }

  private changed(): void {
    this.options.onChanged(this.list())
  }
}

/** Relative to the project when inside it, otherwise absolute. */
function display(root: string, path: string): string {
  const relativePath = relative(root, path)
  return relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath) ? path : relativePath
}

/** Whitespace differences don't make a different process. */
function processId(projectId: string, cwd: string, command: string): string {
  const key = `${projectId}\0${cwd}\0${command.replace(/\s+/g, ' ')}`
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

class SupervisedProcess {
  readonly screen: PtyScreen
  readonly log = new ProcessLog()
  private pid: number | null = null
  private stopRequested = false
  private exitWaiters: (() => void)[] = []

  constructor(
    readonly info: ProcessInfo,
    private readonly absoluteCwd: string,
    onOutput: (data: string, seq: number) => void,
    private readonly onChanged: () => void,
  ) {
    this.screen = new PtyScreen(defaultSize, onOutput)
  }

  get running(): boolean {
    return this.screen.running
  }

  start(): void {
    if (this.info.startedAt) this.note('Restarted', '\r\n')
    Object.assign(this.info, { status: 'running', exitCode: null, startedAt: Date.now(), endedAt: null })
    this.stopRequested = false
    try {
      this.pid = this.screen.spawn('/bin/sh', ['-c', this.info.command], this.absoluteCwd, (data) => this.log.append(data), (exit) =>
        this.exited(exit.exitCode, exit.signal),
      )
    } catch (error) {
      Object.assign(this.info, { status: 'failed', endedAt: Date.now() })
      this.note(`Couldn't start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Asks the process group to terminate, killing it if it hasn't after a grace period. */
  stop(): Promise<void> {
    const pid = this.screen.pid
    if (pid === undefined) return Promise.resolve()
    this.stopRequested = true
    signalGroup(pid, 'SIGTERM')
    const timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), stopGraceMs)
    return new Promise((resolve) => {
      this.exitWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private exited(exitCode: number, signal: number | undefined): void {
    // The pty's process led its group; take anything it left behind with it.
    if (this.stopRequested && this.pid !== null) signalGroup(this.pid, 'SIGKILL')
    const status = this.stopRequested ? 'stopped' : exitCode === 0 && !signal ? 'exited' : 'failed'
    Object.assign(this.info, { status, exitCode, endedAt: Date.now() })
    this.note(status === 'stopped' ? 'Stopped' : `Exited with code ${exitCode}`)
    for (const resolve of this.exitWaiters.splice(0)) resolve()
    this.onChanged()
  }

  private note(message: string, after = ''): void {
    this.screen.write(notice(message) + after)
    this.log.mark(`── ${message} ──`)
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}
