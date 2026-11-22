export const isMac = navigator.userAgent.includes('Mac')

/** ⌘ on macOS, Ctrl elsewhere. */
export const modifierLabel = isMac ? '⌘' : 'Ctrl+'
const shiftLabel = isMac ? '⇧' : 'Shift+'

export function hasModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

/**
 * A key pressed with ⌘ (Ctrl elsewhere). `key` is a lowercase letter, or a
 * `KeyboardEvent.code` for a key whose character Shift changes, such as `BracketLeft`.
 */
export type Shortcut = { key: string; shift?: boolean }

export function matchesShortcut(shortcut: Shortcut, event: KeyboardEvent): boolean {
  return (
    hasModifier(event) &&
    !event.altKey &&
    event.shiftKey === (shortcut.shift ?? false) &&
    (event.key.toLowerCase() === shortcut.key || event.code === shortcut.key)
  )
}

const keyLabels: Record<string, string> = { BracketLeft: '[', BracketRight: ']' }

export function shortcutLabel(shortcut: Shortcut): string {
  return modifierLabel + (shortcut.shift ? shiftLabel : '') + (keyLabels[shortcut.key] ?? shortcut.key.toUpperCase())
}
