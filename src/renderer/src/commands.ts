import { useEffect, useRef } from 'react'
import { matchesShortcut, type Shortcut } from './shortcuts'

/**
 * Something the user can do from the action palette, and from a shortcut if it has one.
 * Shortcuts are fixed: there's one user, so no configuration. Only commands that
 * work `inDialogs` (the palettes, which replace one another) take their shortcut
 * while a dialog has focus; the rest would act on what the dialog covers.
 */
export type Command = { id: string; title: string; shortcut?: Shortcut; inDialogs?: boolean; run: () => void }

// A command is available while the component that offers it is mounted, so
// project commands come and go with the project's workspace.
const registered = new Set<{ current: Command }>()

/** Offers a command while the calling component is mounted. */
export function useCommand(command: Command): void {
  const ref = useRef(command)
  ref.current = command
  useEffect(() => {
    if (registered.size === 0) window.addEventListener('keydown', onKeyDown)
    registered.add(ref)
    return () => {
      registered.delete(ref)
      if (registered.size === 0) window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

export function availableCommands(): Command[] {
  return [...registered].map((ref) => ref.current)
}

function commandFor(event: KeyboardEvent): Command | undefined {
  const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"][data-state="open"]') !== null
  return availableCommands().find(
    (command) => command.shortcut && (command.inDialogs || !inDialog) && matchesShortcut(command.shortcut, event),
  )
}

/** Whether a widget that handles keys itself, such as a terminal, should leave this one to the app. */
export function isCommandKey(event: KeyboardEvent): boolean {
  return event.type === 'keydown' && commandFor(event) !== undefined
}

/**
 * Runs the command the key is a shortcut for, if any. For widgets that would
 * otherwise claim the key first, such as CodeMirror's fold keys on Linux.
 */
export function runCommandKey(event: KeyboardEvent): boolean {
  const command = commandFor(event)
  if (!command) return false
  event.preventDefault()
  command.run()
  return true
}

// Bubbling, so a focused widget that handles the key itself, such as a
// palette's own shortcuts, takes it first.
function onKeyDown(event: KeyboardEvent) {
  if (!event.defaultPrevented) runCommandKey(event)
}
