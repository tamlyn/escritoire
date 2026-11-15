import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { type Connection, defaultConnectionName } from '../../../../shared/sql'
import { errorMessage } from '../../api'
import { useProject } from '../../project-context'
import { deleteConnection, saveConnection, setFileConnection } from '../../sql'

type ConnectionDialogProps = {
  /** The file being edited, which a new connection is chosen for. */
  path: string
  /** `null` to create one. */
  connection: Connection | null
  onClose: () => void
}

export function ConnectionDialog({ path, connection, onClose }: ConnectionDialogProps) {
  const projectId = useProject().id
  const [type, setType] = useState<Connection['type']>(connection?.type ?? 'sqlite')
  const [target, setTarget] = useState(
    connection ? (connection.type === 'sqlite' ? connection.path : connection.url) : '',
  )
  // Follows the URL or path until the user types a name of their own.
  const [customName, setCustomName] = useState(connection?.name ?? '')
  const derivedName = type === 'sqlite' ? defaultConnectionName({ type, path: target }) : defaultConnectionName({ type, url: target })
  const name = customName || derivedName
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const id = connection?.id ?? crypto.randomUUID()
    const saved: Connection =
      type === 'sqlite' ? { id, name: name.trim(), type, path: target.trim() } : { id, name: name.trim(), type, url: target.trim() }
    void attempt(async () => {
      await saveConnection(projectId, saved)
      if (!connection) await setFileConnection(projectId, path, id)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <DialogHeader>
            <DialogTitle>{connection ? `Edit ${connection.name}` : 'New connection'}</DialogTitle>
            <DialogDescription>For this project's SQL files.</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Database" className="bg-muted flex rounded-md p-0.5">
            {(['sqlite', 'postgres'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => setType(option)}
                className={cn(
                  'flex-1 rounded px-3 py-1 text-sm',
                  type === option ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option === 'sqlite' ? 'SQLite' : 'Postgres'}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{type === 'sqlite' ? 'Database file' : 'URL'}</span>
              <Input
                autoFocus
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={type === 'sqlite' ? 'data/app.db' : 'postgres://user@localhost:5432/app'}
                className="font-mono"
                spellCheck={false}
                aria-describedby="connection-target-hint"
              />
            </label>
            <span id="connection-target-hint" className="text-muted-foreground text-xs">
              {type === 'sqlite'
                ? 'Relative to the project, or absolute.'
                : "A password in the URL is moved to ~/.pgpass, where psql finds it too, rather than kept by Escritoire."}
            </span>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input value={name} onChange={(e) => setCustomName(e.target.value)} placeholder={derivedName || 'dev'} />
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            {connection && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive mr-auto"
                disabled={busy}
                onClick={() => void attempt(() => deleteConnection(projectId, connection.id))}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !target.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
