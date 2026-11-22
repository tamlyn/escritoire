import { CaseSensitiveIcon, RegexIcon, WholeWordIcon } from 'lucide-react'
import type { TextQuery } from '../../../shared/search'
import { cn } from '@/lib/utils'
import { isMac } from '../shortcuts'

export type QueryOptions = Pick<TextQuery, 'caseSensitive' | 'wholeWord' | 'regexp'>
type Option = keyof QueryOptions

// WebStorm's keys, with ⌥ (Alt elsewhere).
const toggles: { option: Option; label: string; code: string; icon: typeof CaseSensitiveIcon }[] = [
  { option: 'caseSensitive', label: 'Match case', code: 'KeyC', icon: CaseSensitiveIcon },
  { option: 'wholeWord', label: 'Words', code: 'KeyW', icon: WholeWordIcon },
  { option: 'regexp', label: 'Regex', code: 'KeyX', icon: RegexIcon },
]

/** The search options as toggle buttons, for inside a search field. */
export function QueryToggles({ options, onToggle }: { options: QueryOptions; onToggle: (option: Option) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {toggles.map(({ option, label, code, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={options[option]}
          title={`${label} (${isMac ? '⌥' : 'Alt+'}${code.slice(3)})`}
          // Keeps focus in the search field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onToggle(option)}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 items-center justify-center rounded-sm',
            options[option] && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary ring-primary/40 ring-1 ring-inset',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  )
}

/** The option a key toggles, if it's one of the toggles' shortcuts. */
export function toggledOption(event: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; code: string }): Option | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null
  return toggles.find((toggle) => toggle.code === event.code)?.option ?? null
}
