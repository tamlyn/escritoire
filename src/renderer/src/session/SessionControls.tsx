import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type {
  ContextUsage,
  ModelChoice,
  PlanLimit,
  SessionPointer,
  SessionSettings,
  SettingChoices,
} from '../../../shared/agent'
import { api } from '../api'
import { compact, UsageIndicator } from './UsageIndicator'

const defaultValue = ''

/** The session's model, effort and permission mode, and how full its context and cache are. */
export function SessionControls({
  pointer,
  settings,
  choices,
  usage,
  limits,
  working,
}: {
  pointer: SessionPointer
  settings: SessionSettings
  choices: SettingChoices | null
  usage?: ContextUsage
  limits?: PlanLimit[]
  working: boolean
}) {
  const change = (next: SessionSettings) => void api.changeSessionSettings(pointer, next)
  const model = choices && findModel(choices.models, settings.model)
  const efforts = (model ?? choices?.models.find((m) => m.id === 'default'))?.efforts ?? []
  const mode = choices?.permissionModes.find((m) => m.id === settings.permissionMode)

  return (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      <Picker
        // The user's settings choose the mode until a run reports it.
        label={mode?.label ?? (settings.permissionMode === 'custom' ? 'Custom permissions' : settings.permissionMode) ?? 'Default mode'}
        title="Permission mode (Shift+Tab)"
        value={settings.permissionMode ?? defaultValue}
        options={choices?.permissionModes ?? []}
        onChange={(id) => change({ permissionMode: id })}
      />
      <Picker
        label={model?.label ?? settings.model ?? 'Default model'}
        title="Model"
        value={model?.id ?? defaultValue}
        options={(choices?.models ?? []).map((m) => ({ id: m.id, label: m.label, description: m.description }))}
        // The agent's default follows the user's settings, so isn't pinned as a model.
        onChange={(id) => change({ model: id === 'default' ? null : id })}
      />
      {efforts.length > 0 && (
        <Picker
          label={settings.effort ? `${capitalize(settings.effort)} effort` : 'Default effort'}
          title="Effort"
          value={settings.effort ?? defaultValue}
          options={[{ id: defaultValue, label: 'Default' }, ...efforts.map((e) => ({ id: e, label: capitalize(e) }))]}
          onChange={(id) => change({ effort: id || null })}
        />
      )}
      <div className="ml-auto flex items-center gap-3">
        <UsageIndicator usage={usage} limits={limits} />
        {usage && (pointer.agent === 'claude' ? <CacheIndicator usage={usage} working={working} /> : (
          <span title={`The latest request read ${usage.cacheReadTokens.toLocaleString()} tokens from the prompt cache.`}>
            {compact(usage.cacheReadTokens)} cached
          </span>
        ))}
      </div>
    </div>
  )
}

/** The next permission mode, for cycling through them as Claude Code's Shift+Tab does. */
export function nextPermissionMode(choices: SettingChoices | null, current: string | null | undefined): string | undefined {
  const modes = choices?.permissionModes ?? []
  if (modes.length === 0) return undefined
  const index = modes.findIndex((m) => m.id === current)
  return modes[(index + 1) % modes.length]!.id
}

// Claude Code reports the model it resolved, such as `claude-opus-5-5`, where
// the choices are mostly aliases that resolve to it.
function findModel(models: ModelChoice[], model: string | null | undefined): ModelChoice | undefined {
  if (!model) return models.find((m) => m.id === 'default')
  return (
    models.find((m) => m.id === model) ??
    models.find((m) => m.id !== 'default' && m.resolvedId === model) ??
    models.find((m) => m.resolvedId === model)
  )
}

function Picker({
  label,
  title,
  value,
  options,
  onChange,
}: {
  label: string
  title: string
  value: string
  options: { id: string; label: string; description?: string }[]
  onChange: (id: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={title}
        disabled={options.length === 0}
        className="hover:bg-muted hover:text-foreground data-[state=open]:bg-muted flex items-center gap-1 rounded px-1.5 py-1 outline-none compact:py-2"
      >
        {label}
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-96 min-w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="flex-col items-start gap-0">
              {option.label}
              {option.description && (
                <span className="text-muted-foreground text-xs">{option.description}</span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The API's default when a session hasn't yet written to the cache.
const defaultCacheTtlMs = 5 * 60_000

function CacheIndicator({ usage, working }: { usage: ContextUsage; working: boolean }) {
  // The clock only ticks occasionally, so it can lag behind a request that just finished.
  const now = Math.max(useNow(15_000), usage.at)
  const ttl = usage.cacheTtlMs ?? defaultCacheTtlMs
  const expiresAt = usage.at + ttl
  // Every request during a turn reads the cache and so keeps it warm.
  const warm = working || now < expiresAt
  const title = [
    `The latest request read ${usage.cacheReadTokens.toLocaleString()} tokens from the prompt cache and wrote ${usage.cacheWriteTokens.toLocaleString()}.`,
    `Cached prompts live for ${ttl / 60_000} minutes after each request${usage.cacheTtlMs ? '' : ' (assumed)'}.`,
    warm && !working ? `Expires at ${new Date(expiresAt).toLocaleTimeString([], { timeStyle: 'short' })}.` : '',
  ].join(' ')
  return (
    <span title={title} className="flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full', warm ? 'bg-green-600' : 'bg-muted-foreground/40')} />
      {working ? 'Cache warm' : warm ? `Cache ${Math.ceil((expiresAt - now) / 60_000)}m` : 'Cache cold'}
    </span>
  )
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
