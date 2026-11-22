import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { CacheIndicator } from './CacheIndicator'
import { UsageIndicator } from './UsageIndicator'

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
  const change = (next: SessionSettings, asDefault = false) => void api.changeSessionSettings(pointer, next, asDefault)
  const model = choices && findModel(choices.models, settings.model)
  const effortModel = model ?? choices?.models.find((m) => m.id === 'default')
  const efforts = effortModel?.efforts ?? []
  const effort = effortModel ? effortFor(effortModel, settings.effort) : null
  const mode = choices?.permissionModes.find((m) => m.id === settings.permissionMode)

  // Always pinned, since what the agent's default stands for isn't always known.
  useEffect(() => {
    if (effortModel && effort !== (settings.effort ?? null)) void api.changeSessionSettings(pointer, { effort }, false)
  }, [pointer, effortModel, effort, settings.effort])

  return (
    <div className="text-muted-foreground -ml-1.5 flex items-center gap-0.5 text-xs compact:text-[13px]">
      <Picker
        // The user's settings choose the mode until a run reports it.
        label={mode?.label ?? (settings.permissionMode === 'custom' ? 'Custom permissions' : settings.permissionMode) ?? 'Default mode'}
        title="Permission mode (Shift+Tab)"
        value={settings.permissionMode ?? defaultValue}
        options={choices?.permissionModes ?? []}
        onChange={(id) => change({ permissionMode: id })}
      />
      <ModelPicker
        label={(choices && model && modelLabel(choices.models, model)) ?? settings.model ?? 'Default model'}
        models={choices?.models ?? []}
        model={model?.id ?? defaultValue}
        efforts={efforts}
        effort={effort}
        // The agent's default follows the user's settings, so isn't pinned as a model.
        onModelChange={(id, asDefault) => change({ model: id === 'default' ? null : id }, asDefault)}
        onEffortChange={(next, asDefault) => change({ effort: next }, asDefault)}
      />
      <div className="ml-auto flex items-center gap-0.5">
        <UsageIndicator pointer={pointer} usage={usage} limits={limits} />
        {usage && <CacheIndicator pointer={pointer} usage={usage} working={working} />}
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

// The session's effort, or the one it moves to when it has none (the user
// hasn't chosen one yet) or the model doesn't support it.
function effortFor(model: ModelChoice, effort: string | null | undefined): string | null {
  const { efforts, defaultEffort } = model
  if (effort && efforts.includes(effort)) return effort
  if (defaultEffort && efforts.includes(defaultEffort)) return defaultEffort
  return efforts[Math.floor((efforts.length - 1) / 2)] ?? null
}

// Until the agent reports the model it chose, the default is named by the model it stands for.
function modelLabel(models: ModelChoice[], model: ModelChoice): string {
  if (model.id !== 'default' || !model.resolvedId) return model.label
  return models.find((m) => m.id !== 'default' && m.resolvedId === model.resolvedId)?.label ?? model.label
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
        className="hover:bg-accent hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground flex h-6 items-center gap-1 rounded-sm px-1.5 outline-none compact:h-11"
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

function ModelPicker({
  label,
  models,
  model,
  efforts,
  effort,
  onModelChange,
  onEffortChange,
}: {
  label: string
  models: ModelChoice[]
  model: string
  efforts: string[]
  effort: string | null
  onModelChange: (id: string, asDefault: boolean) => void
  onEffortChange: (effort: string, asDefault: boolean) => void
}) {
  // Whether Shift was held for the click or key that chose a model.
  const shift = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Model"
        disabled={models.length === 0}
        className="hover:bg-accent hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground flex h-6 items-center gap-1 rounded-sm px-1.5 outline-none compact:h-11"
      >
        {label}
        {effort && <span className="opacity-70">· {capitalize(effort)}</span>}
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      {/* The models scroll; effort stays in view beneath them. */}
      <DropdownMenuContent
        align="start"
        side="top"
        className="flex max-h-96 min-w-64 flex-col overflow-hidden"
        onPointerDownCapture={(event) => { shift.current = event.shiftKey }}
        onKeyDownCapture={(event) => { shift.current = event.shiftKey }}
      >
        <DropdownMenuLabel>Shift to change this session only</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={model}
          onValueChange={(id) => onModelChange(id, !shift.current)}
          className="min-h-0 overflow-y-auto"
        >
          {models.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="flex-col items-start gap-0">
              {option.label}
              {option.description && <span className="text-muted-foreground text-xs">{option.description}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {efforts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <EffortSlider efforts={efforts} effort={effort} onChange={onEffortChange} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A menu item, so arrow keys reach it, that steps through the efforts with Left and Right. */
function EffortSlider({
  efforts,
  effort,
  onChange,
}: {
  efforts: string[]
  effort: string | null
  onChange: (effort: string, asDefault: boolean) => void
}) {
  const step = (by: number, asDefault: boolean) => {
    const index = effort ? efforts.indexOf(effort) : -1
    const next = efforts[Math.min(Math.max(index + by, 0), efforts.length - 1)]
    if (next && next !== effort) onChange(next, asDefault)
  }
  return (
    <DropdownMenuItem
      title="Effort (← →)"
      // Only the dots are clickable, so pointing at the row doesn't highlight it; arriving by keyboard does, faintly.
      className="justify-between gap-4 focus:bg-transparent focus:text-popover-foreground focus:[&_.text-muted-foreground]:text-muted-foreground focus-visible:bg-accent"
      onSelect={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1, !event.shiftKey)
        else if (event.key === 'ArrowRight') step(1, !event.shiftKey)
        else return
        event.preventDefault()
      }}
    >
      <span>
        Effort {effort && <span className="text-muted-foreground">({capitalize(effort)})</span>}
      </span>
      <span role="radiogroup" aria-label="Effort" className="bg-muted flex items-center rounded-full p-0.5">
        {efforts.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={e === effort}
            aria-label={capitalize(e)}
            tabIndex={-1}
            className="flex size-5 items-center justify-center"
            onClick={(event) => onChange(e, !event.shiftKey)}
          >
            <span className={cn('rounded-full', e === effort ? 'bg-foreground size-3.5' : 'bg-muted-foreground size-1')} />
          </button>
        ))}
      </span>
    </DropdownMenuItem>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
