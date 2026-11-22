import { useMemo, useRef } from 'react'
import { availableCommands, type Command as AppCommand } from './commands'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from './components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { shortcutLabel } from './shortcuts'

/** Searches the commands available where the user is, to run one. */
export function ActionPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Read as it opens: commands come and go as the user moves around, and titles change.
  const commands = useMemo(() => (open ? availableCommands() : []), [open])
  const chosen = useRef<AppCommand | null>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-[620px]"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          // Run once the dialog has let go of focus, so a command that focuses
          // something (a new session's composer) keeps it.
          const command = chosen.current
          chosen.current = null
          if (!command) return
          event.preventDefault()
          command.run()
        }}
      >
        <DialogTitle className="sr-only">Actions</DialogTitle>
        <DialogDescription className="sr-only">Search for an action to run</DialogDescription>
        <Command>
          <CommandInput placeholder="Search actions…" />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No matching actions.</CommandEmpty>
            {commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.title}
                onSelect={() => {
                  chosen.current = command
                  onOpenChange(false)
                }}
              >
                {command.title}
                {command.shortcut && <CommandShortcut className="tracking-normal">{shortcutLabel(command.shortcut)}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
