import type { Terminal } from '@xterm/xterm'
import { useRef, useState } from 'react'
import { api } from '../api'
import { useProject } from '../project-context'
import { ScreenView } from '../screen/ScreenView'
import { terminalConnection } from '../screen/TerminalTab'
import { withCtrl } from './phone-views'

const arrows = [
  { label: '←', name: 'Left', final: 'D' },
  { label: '↑', name: 'Up', final: 'A' },
  { label: '↓', name: 'Down', final: 'B' },
  { label: '→', name: 'Right', final: 'C' },
]

const keyClass = 'bg-background flex h-10 min-w-11 flex-1 items-center justify-center rounded-md border text-sm aria-pressed:bg-accent'

/** A terminal with the keys a phone's keyboard lacks. */
export function PhoneTerminal({ terminalId }: { terminalId: string }) {
  const projectId = useProject().id
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(ctrl)
  ctrlRef.current = ctrl

  const screen = useRef<Terminal>(null)

  // Full-screen programs such as nano and htop switch the arrow keys to different sequences.
  const arrow = (final: string) => `${screen.current?.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b['}${final}`

  function write(data: string) {
    if (ctrlRef.current) setCtrl(false)
    void api.writeTerminal(terminalId, ctrlRef.current ? withCtrl(data) : data)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ScreenView
          screenId={terminalId}
          terminalRef={screen}
          connection={{ ...terminalConnection(projectId, terminalId), write }}
        />
      </div>
      {/* Pressing a key mustn't take focus from the terminal, which would close the keyboard. */}
      <div className="bg-chrome flex shrink-0 gap-1 border-t p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" aria-pressed={ctrl} onClick={() => setCtrl(!ctrl)} className={keyClass}>Ctrl</button>
        <button type="button" onClick={() => write('\x1b')} className={keyClass}>Esc</button>
        <button type="button" onClick={() => write('\t')} className={keyClass}>Tab</button>
        {arrows.map(({ label, name, final }) => (
          <button key={name} type="button" aria-label={name} onClick={() => write(arrow(final))} className={keyClass}>{label}</button>
        ))}
      </div>
    </div>
  )
}
