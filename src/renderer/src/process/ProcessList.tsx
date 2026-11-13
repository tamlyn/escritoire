import { XIcon } from 'lucide-react'
import type { ProcessInfo } from '../../../shared/process'
import { api } from '../api'
import { useProcesses } from '../processes'
import { useProject } from '../project-context'
import { ProcessStatusDot } from './ProcessStatusDot'

/** The project's processes, including those agents started; hidden when there are none. */
export function ProcessList({ onOpen }: { onOpen: (process: ProcessInfo) => void }) {
  const project = useProject()
  const processes = useProcesses(project.id)
  if (processes.length === 0) return null

  return (
    <section aria-label="Processes" className="max-h-1/3 shrink-0 overflow-y-auto border-t py-1 text-sm">
      <h2 className="text-muted-foreground px-3 py-1 text-xs font-medium">Processes</h2>
      <ul>
        {processes.map((process) => (
          <li key={process.id} className="group hover:bg-accent flex items-center pr-1">
            <button
              type="button"
              onClick={() => onOpen(process)}
              title={process.cwd ? `${process.command} (in ${process.cwd})` : process.command}
              className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-left"
            >
              <span className="flex w-2 shrink-0 justify-center">
                <ProcessStatusDot process={process} />
              </span>
              <span className={`truncate ${process.status === 'running' ? '' : 'text-muted-foreground'}`}>
                {process.command}
              </span>
              {process.cwd && <span className="text-muted-foreground shrink-0 text-xs">{process.cwd}</span>}
            </button>
            {process.status !== 'running' && (
              <button
                type="button"
                aria-label={`Remove ${process.command}`}
                title="Remove"
                onClick={() => void api.removeProcess(project.id, process.id)}
                className="text-muted-foreground hover:text-foreground invisible flex size-5 shrink-0 items-center justify-center rounded group-hover:visible"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
