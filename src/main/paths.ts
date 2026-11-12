import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function collapseHome(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

const maxCompletions = 20

export async function completeDirectory(partialPath: string): Promise<string[]> {
  const expanded = expandHome(partialPath)
  const endsWithSeparator = expanded.endsWith('/')
  const parent = endsWithSeparator ? expanded : dirname(expanded)
  const prefix = endsWithSeparator ? '' : basename(expanded).toLowerCase()

  let entries
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch {
    return []
  }

  const matches = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().startsWith(prefix))
    .filter((name) => prefix.startsWith('.') || !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, maxCompletions)
    .map((name) => join(parent, name))

  return partialPath.startsWith('~') ? matches.map(collapseHome) : matches
}
