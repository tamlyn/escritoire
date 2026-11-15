/// <reference types="electron-vite/node" />
import { fork } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { maxResultRows, type StatementResult } from '../../shared/sql'
import type { Database, OnLost } from './database'
import childPath from './sqlite-child?modulePath'

export async function openSqlite(path: string, onLost: OnLost): Promise<Database> {
  // SQLite would otherwise create an empty database at a mistyped path.
  if (!(await stat(path).catch(() => null))?.isFile()) throw new Error(`No SQLite database at ${path}`)

  const child = fork(childPath, [path, String(maxResultRows)], {
    // Under Electron, the executable is Electron itself.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr!.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-2000) })
  let pending: ((result: StatementResult) => void) | undefined
  let failure: string | undefined
  let exited = false
  const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const settle = (result: StatementResult) => {
    pending?.(result)
    pending = undefined
  }
  child.on('message', (result) => settle(result as StatementResult))
  child.on('error', (error) => { failure ??= error.message })
  void exit.then(() => {
    exited = true
    failure ??= openFailure(stderr) ?? 'SQLite stopped unexpectedly'
    settle({ kind: 'error', message: failure })
    onLost()
  })
  const stop = async (reason: string) => {
    failure ??= reason
    if (!exited) child.kill('SIGKILL')
    await exit
  }

  return {
    run: (sql) =>
      new Promise((resolve) => {
        if (exited) return resolve({ kind: 'error', message: failure! })
        pending = resolve
        child.send(sql)
      }),
    cancel: async () => {
      if (pending) await stop('Cancelled. The SQLite connection was closed, so any open transaction was rolled back.')
    },
    close: () => stop('Connection closed'),
  }
}

/** The message of an error thrown while opening, from the child's last words. */
function openFailure(stderr: string): string | undefined {
  return /^Error: (.*)$/m.exec(stderr)?.[1]
}
