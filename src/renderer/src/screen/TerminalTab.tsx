import { api } from '../api'
import { useProject } from '../project-context'
import type { Tab } from '../tabs'
import { ScreenView } from './ScreenView'

/** An interactive shell; the tab's id identifies it in main. */
export function TerminalTab({ tab }: { tab: Tab }) {
  const projectId = useProject().id
  const terminalId = tab.id
  return (
    <ScreenView
      screenId={terminalId}
      connection={{
        attach: (size) => api.attachTerminal(projectId, terminalId, size),
        detach: () => void api.detachTerminal(terminalId),
        write: (data) => void api.writeTerminal(terminalId, data),
        resize: (size) => void api.resizeTerminal(terminalId, size),
      }}
    />
  )
}
