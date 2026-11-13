import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { isTaskFile, type TaskRef } from '../shared/process'

/**
 * The command a task runs as, so a task started from a run icon and the same
 * command typed by an agent are one process.
 */
export async function taskCommand(projectPath: string, task: TaskRef): Promise<{ command: string; cwd: string }> {
  const cwd = dirname(task.file)
  const fileName = basename(task.file)
  if (!isTaskFile(fileName)) throw new Error(`Not a task file: ${task.file}`)
  switch (fileName) {
    case 'package.json':
      return { command: `${await packageManager(projectPath, cwd)} run ${shellQuote(task.name)}`, cwd }
    default:
      return { command: `mise run ${shellQuote(task.name)}`, cwd }
  }
}

const lockFiles: [string, string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

/** From the nearest `packageManager` field or lock file, up to the project root. */
async function packageManager(projectPath: string, from: string): Promise<string> {
  for (let dir = from; ; dir = dirname(dir)) {
    const declared = await readPackageManager(join(dir, 'package.json'))
    if (declared) return declared
    for (const [file, manager] of lockFiles) if (await exists(join(dir, file))) return manager
    if (relative(projectPath, dir) === '' || dirname(dir) === dir) return 'npm'
  }
}

async function readPackageManager(path: string): Promise<string | undefined> {
  try {
    const field = (JSON.parse(await readFile(path, 'utf8')) as { packageManager?: unknown }).packageManager
    return typeof field === 'string' ? field.split('@')[0] || undefined : undefined
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

export function shellQuote(word: string): string {
  return /^[\w:.@/+=-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`
}
