import { ActivityIcon, SquareIcon } from 'lucide-react'
import type { BackgroundTask, SessionPointer } from '../../../shared/agent'
import { api } from '../api'

/** What the agent has left running, such as monitors, which will wake it when they report. */
export function BackgroundTasks({ tasks, pointer }: { tasks: BackgroundTask[]; pointer: SessionPointer }) {
  if (tasks.length === 0) return null
  return (
    <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
      {tasks.map((task) => (
        <div key={task.id} className="group flex items-center gap-2">
          <ActivityIcon className="size-3.5 shrink-0 animate-pulse" />
          <span className="min-w-0 truncate" title={task.description}>
            <span className="text-foreground">{task.kind}</span> {task.description}
          </span>
          <button
            type="button"
            title="Stop"
            onClick={() => void api.stopTask(pointer, task.id)}
            className="hover:text-foreground opacity-0 group-hover:opacity-100 max-sm:p-2 max-sm:opacity-100"
          >
            <SquareIcon className="size-3 fill-current" />
          </button>
        </div>
      ))}
    </div>
  )
}
