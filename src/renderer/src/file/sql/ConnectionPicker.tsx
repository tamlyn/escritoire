import { CheckIcon, ChevronDownIcon, DatabaseIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Connection, ProjectConnections } from '../../../../shared/sql'
import { useProject } from '../../project-context'
import { setFileConnection } from '../../sql'

type ConnectionPickerProps = {
  path: string
  state: ProjectConnections
  current: Connection | undefined
  /** `null` to create one. */
  onEdit: (connection: Connection | null) => void
  onChosen: () => void
}

export function ConnectionPicker({ path, state, current, onEdit, onChosen }: ConnectionPickerProps) {
  const projectId = useProject().id
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2.5" title="Connection to run on">
          <DatabaseIcon className="text-muted-foreground" />
          {current ? current.name : <span className="text-muted-foreground">No connection</span>}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-56">
        {state.connections.map((connection) => (
          <DropdownMenuItem
            key={connection.id}
            onSelect={() => {
              void setFileConnection(projectId, path, connection.id)
              onChosen()
            }}
          >
            <CheckIcon className={connection.id === current?.id ? '' : 'invisible'} />
            {connection.name}
            <span className="text-muted-foreground ml-auto pl-4 text-xs">
              {connection.type === 'sqlite' ? 'SQLite' : 'Postgres'}
            </span>
          </DropdownMenuItem>
        ))}
        {state.connections.length > 0 && <DropdownMenuSeparator />}
        {current && (
          <DropdownMenuItem onSelect={() => onEdit(current)}>
            <PencilIcon />
            Edit {current.name}…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onEdit(null)}>
          <PlusIcon />
          New connection…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
