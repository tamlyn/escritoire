import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { type IPty, spawn } from 'node-pty'
import type { ProcessInfo, ProcessSpec, TaskRef } from '../shared/process'
import type { ScreenOutput, ScreenSize, ScreenSnapshot } from '../shared/screen'
import { type LogError, type LogLine, ProcessLog } from './process-log'
import { notice, ptyEnv, Screen } from './screen'
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
    supervised.resize(size)
    supervised.screen.attached = true
    return supervised.screen.snapshot()
  }

  detach(id: string): void {
    const supervised = this.processes.get(id)
    if (supervised) supervised.screen.attached = false
  }

  write(projectId: string, id: string, data: string): void {
    this.get(projectId, id).write(data)
  }

  resize(projectId: string, id: string, size: ScreenSize): void {
    this.get(projectId, id).resize(size)
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
      const file = inside(root, await realpath(resolve(root, spec.task.file)))
      task = { file: relative(root, file), name: spec.task.name }
      ;({ command, cwd: directory } = await taskCommand(root, { file, name: task.name }))
    } else {
      command = spec.command.trim()
      if (!command) throw new Error('The command is empty.')
      directory = resolve(root, spec.cwd ?? '.')
    }
    const absoluteCwd = inside(root, await realpath(directory))
    return { command, cwd: relative(root, absoluteCwd), absoluteCwd, task }
  }

  private changed(): void {
    this.options.onChanged(this.list())
  }
}

function inside(root: string, path: string): string {
  const relativePath = relative(root, path)
  if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
    throw new Error(`${path} is outside the project.`)
  }
  return path
}

/** Whitespace differences don't make a different process. */
function processId(projectId: string, cwd: string, command: string): string {
  const key = `${projectId}\0${cwd}\0${command.replace(/\s+/g, ' ')}`
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

class SupervisedProcess {
  readonly screen: Screen
  readonly log = new ProcessLog()
  private pty: IPty | null = null
  private stopRequested = false
  private exitWaiters: (() => void)[] = []

  constructor(
    readonly info: ProcessInfo,
    private readonly absoluteCwd: string,
    onOutput: (data: string, seq: number) => void,
    private readonly onChanged: () => void,
  ) {
    this.screen = new Screen(defaultSize, onOutput)
  }

  get running(): boolean {
    return this.pty !== null
  }

  start(): void {
    if (this.info.startedAt) {
      this.screen.write(`${notice('Restarted')}\r\n`)
      this.log.mark('── Restarted ──')
    }
    Object.assign(this.info, { status: 'running', exitCode: null, startedAt: Date.now(), endedAt: null })
    this.stopRequested = false
    const pty = spawn('/bin/sh', ['-c', this.info.command], {
      ...this.screen.currentSize,
      cwd: this.absoluteCwd,
      name: 'xterm-256color',
      env: ptyEnv(),
    })
    pty.onData((data) => {
      this.screen.write(data)
      this.log.append(data)
    })
    pty.onExit(({ exitCode, signal }) => {
      if (this.pty !== pty) return
      this.pty = null
      // The pty's process leads its group; take anything it left behind with it.
      if (this.stopRequested) signalGroup(pty.pid, 'SIGKILL')
      const status = this.stopRequested ? 'stopped' : exitCode === 0 && !signal ? 'exited' : 'failed'
      Object.assign(this.info, { status, exitCode, endedAt: Date.now() })
      const message = status === 'stopped' ? 'Stopped' : `Exited with code ${exitCode}`
      this.screen.write(notice(message))
      this.log.mark(`── ${message} ──`)
      for (const resolve of this.exitWaiters.splice(0)) resolve()
      this.onChanged()
    })
    this.pty = pty
  }

  /** Asks the process group to terminate, killing it if it hasn't after a grace period. */
  stop(): Promise<void> {
    const pty = this.pty
    if (!pty) return Promise.resolve()
    this.stopRequested = true
    signalGroup(pty.pid, 'SIGTERM')
    const timer = setTimeout(() => signalGroup(pty.pid, 'SIGKILL'), stopGraceMs)
    return new Promise((resolve) => {
      this.exitWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  write(data: string): void {
    this.pty?.write(data)
  }

  resize(size: ScreenSize): void {
    if (this.screen.resize(size)) this.pty?.resize(size.cols, size.rows)
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}
