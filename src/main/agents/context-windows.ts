import { readJson, writeJson } from '../json-file'

/**
 * Context window sizes by model. Claude Code only reports one once a turn ends
 * or it's asked, so remembering them lets a session show how full its context
 * is as soon as it loads. Without a path they're only remembered in memory.
 */
export class ContextWindows {
  private constructor(
    private readonly windows: Map<string, number>,
    private readonly path?: string,
  ) {}

  static async load(path?: string): Promise<ContextWindows> {
    const saved = path ? await readJson(path).catch(() => undefined) : undefined
    const entries = saved && typeof saved === 'object' ? Object.entries(saved) : []
    return new ContextWindows(
      new Map(entries.filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
      path,
    )
  }

  static inMemory(): ContextWindows {
    return new ContextWindows(new Map())
  }

  get(model: string): number | undefined {
    return this.windows.get(model)
  }

  set(model: string, size: number): void {
    if (this.windows.get(model) === size) return
    this.windows.set(model, size)
    if (this.path) void writeJson(this.path, Object.fromEntries(this.windows)).catch(console.error)
  }
}
