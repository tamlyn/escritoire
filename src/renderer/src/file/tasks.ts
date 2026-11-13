/** A task defined in the file, and the offset of the line it's defined on. */
export type FoundTask = { name: string; offset: number }

export function isTaskFile(fileName: string): boolean {
  return fileName === 'package.json' || fileName === 'mise.toml' || fileName === '.mise.toml'
}

/** Scripts in a package.json, or tasks in a mise.toml; nothing for other files. */
export function findTasks(fileName: string, text: string): FoundTask[] {
  if (fileName === 'package.json') return packageScripts(text)
  if (isTaskFile(fileName)) return miseTasks(text)
  return []
}

function packageScripts(text: string): FoundTask[] {
  let scripts: unknown
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts
  } catch {
    return []
  }
  if (!scripts || typeof scripts !== 'object') return []
  // JSON.parse gives no positions, so find each key after "scripts".
  let from = text.search(/"scripts"\s*:/)
  const found: FoundTask[] = []
  for (const name of Object.keys(scripts)) {
    const match = new RegExp(`${escapeRegExp(JSON.stringify(name))}\\s*:`, 'g')
    match.lastIndex = from
    const result = match.exec(text)
    if (!result) continue
    found.push({ name, offset: result.index })
    from = result.index + result[0].length
  }
  return found
}

const tomlKey = String.raw`(?:"([^"]+)"|'([^']+)'|([\w.:-]+))`
const taskTable = new RegExp(String.raw`^\s*\[tasks\.${tomlKey}\]\s*(?:#.*)?$`)
const tableHeader = /^\s*\[/
const keyValue = new RegExp(String.raw`^\s*${tomlKey}\s*=`)

/** `[tasks.name]` tables, and `name = ...` entries in a `[tasks]` table. */
function miseTasks(text: string): FoundTask[] {
  const found: FoundTask[] = []
  let inTasksTable = false
  let offset = 0
  for (const line of text.split('\n')) {
    const table = taskTable.exec(line)
    if (table) {
      found.push({ name: table[1] ?? table[2] ?? table[3]!, offset })
      inTasksTable = false
    } else if (tableHeader.test(line)) {
      inTasksTable = /^\s*\[tasks\]\s*(?:#.*)?$/.test(line)
    } else if (inTasksTable) {
      const entry = keyValue.exec(line)
      if (entry) found.push({ name: entry[1] ?? entry[2] ?? entry[3]!, offset })
    }
    offset += line.length + 1
  }
  return found
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
