import { useRef, useState } from 'react'
import { api } from '../api'
import { useProject } from '../project-context'
import { ScreenView } from '../screen/ScreenView'
import { withCtrl } from './phone-views'

const keys = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '←', name: 'Left', data: '\x1b[D' },
  { label: '↑', name: 'Up', data: '\x1b[A' },
  { label: '↓', name: 'Down', data: '\x1b[B' },
  { label: '→', name: 'Right', data: '\x1b[C' },
]

const keyClass = 'bg-background flex h-10 min-w-11 flex-1 items-center justify-center rounded-md border text-sm aria-pressed:bg-accent'

/** A terminal with the keys a phone's keyboard lacks. */
export function PhoneTerminal({ terminalId }: { terminalId: string }) {
  const projectId = useProject().id
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(ctrl)
  ctrlRef.current = ctrl

  function write(data: string) {
    if (ctrlRef.current) setCtrl(false)
    void api.writeTerminal(terminalId, ctrlRef.current ? withCtrl(data) : data)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ScreenView
          screenId={terminalId}
          shown
          connection={{
            attach: (size) => api.attachTerminal(projectId, terminalId, size),
            detach: () => void api.detachTerminal(terminalId),
            write,
            resize: (size) => void api.resizeTerminal(terminalId, size),
          }}
        />
      </div>
      {/* Pressing a key mustn't take focus from the terminal, which would close the keyboard. */}
      <div className="bg-chrome flex shrink-0 gap-1 border-t p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" aria-pressed={ctrl} onClick={() => setCtrl(!ctrl)} className={keyClass}>Ctrl</button>
        {keys.map(({ label, name, data }) => (
          <button key={label} type="button" aria-label={name} onClick={() => write(data)} className={keyClass}>{label}</button>
        ))}
      </div>
    </div>
  )
}
