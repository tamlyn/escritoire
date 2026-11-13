import { PlayIcon, RotateCwIcon, SquareIcon } from 'lucide-react'
import type { ProcessInfo, TaskRef } from '../../../shared/process'
import { api } from '../api'
import { useProcess } from '../processes'
import { useProject } from '../project-context'
import { ScreenView } from '../screen/ScreenView'
import { Centred } from '../tabs'
import { ProcessStatusDot } from './ProcessStatusDot'

type ProcessTabProps = { processId: string; command: string; cwd: string; task?: TaskRef }

/**
 * A process's output. The tab doesn't own the process: closing it leaves the
 * process running, and after an app restart the tab offers to start it again.
 */
export function ProcessTab({ processId, command, cwd, task }: ProcessTabProps) {
  const projectId = useProject().id
  const process = useProcess(processId)
  const start = () => void api.startProcess(projectId, task ? { task } : { command, cwd })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm">
        {process && <ProcessStatusDot process={process} />}
        <code className="min-w-0 truncate">{command}</code>
        {cwd && <span className="text-muted-foreground shrink-0">in {cwd}</span>}
        <span className="text-muted-foreground shrink-0">{process ? describe(process) : 'Not running'}</span>
        <div className="ml-auto flex shrink-0 gap-1">
          {process?.status === 'running' ? (
            <>
              <ToolbarButton label="Restart" onClick={() => void api.restartProcess(projectId, processId)}>
                <RotateCwIcon className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton label="Stop" onClick={() => void api.stopProcess(projectId, processId)}>
                <SquareIcon className="size-3.5" />
              </ToolbarButton>
            </>
          ) : (
            <ToolbarButton label="Start" onClick={start}>
              <PlayIcon className="size-3.5" />
            </ToolbarButton>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {process ? (
          <ScreenView
            screenId={processId}
            connection={{
              attach: (size) => api.attachProcess(projectId, processId, size),
              detach: () => void api.detachProcess(processId),
              write: (data) => void api.writeProcess(projectId, processId, data),
              resize: (size) => void api.resizeProcess(projectId, processId, size),
            }}
          />
        ) : (
          <Centred>Not running.</Centred>
        )}
      </div>
    </div>
  )
}

function describe(process: ProcessInfo): string {
  switch (process.status) {
    case 'running':
      return 'Running'
    case 'stopped':
      return 'Stopped'
    case 'exited':
      return 'Exited'
    case 'failed':
      return `Failed (exit code ${process.exitCode})`
  }
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 items-center justify-center rounded"
    >
      {children}
    </button>
  )
}
