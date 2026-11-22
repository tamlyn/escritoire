import type { AgentKind, SessionSettings } from '../shared/agent'
import { readJson, writeJson } from './json-file'

export type DefaultSettings = Pick<SessionSettings, 'model' | 'effort'>

/**
 * The model and effort the user last chose for each agent, which new sessions
 * start with. Without a path they're only remembered in memory.
 */
export class SettingDefaults {
  private constructor(
    private readonly defaults: Partial<Record<AgentKind, DefaultSettings>>,
    private readonly path?: string,
  ) {}

  static async load(path?: string): Promise<SettingDefaults> {
    const saved = path ? await readJson(path).catch(() => undefined) : undefined
    return new SettingDefaults(saved && typeof saved === 'object' ? saved : {}, path)
  }

  static inMemory(): SettingDefaults {
    return new SettingDefaults({})
  }

  get(agent: AgentKind): DefaultSettings {
    return { ...this.defaults[agent] }
  }

  remember(agent: AgentKind, settings: SessionSettings): void {
    const chosen: DefaultSettings = {
      ...('model' in settings ? { model: settings.model } : {}),
      ...('effort' in settings ? { effort: settings.effort } : {}),
    }
    if (Object.keys(chosen).length === 0) return
    this.defaults[agent] = { ...this.defaults[agent], ...chosen }
    if (this.path) void writeJson(this.path, this.defaults).catch(console.error)
  }
}
