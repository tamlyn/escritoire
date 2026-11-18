import { ImageIcon, PencilIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { QueuedMessage, SessionPointer } from '../../../shared/agent'
import { api } from '../api'

/** Messages waiting for the turn to end, each of which can still be edited or cancelled. */
export function QueuedMessages({ queued, pointer }: { queued: QueuedMessage[]; pointer: SessionPointer }) {
  if (queued.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {queued.map((message) => (
        <Queued key={message.id} message={message} pointer={pointer} />
      ))}
    </div>
  )
}

function Queued({ message, pointer }: { message: QueuedMessage; pointer: SessionPointer }) {
  const [editing, setEditing] = useState<string | null>(null)
  // Escape removes the textarea, which may blur it, and that mustn't save.
  const discarding = useRef(false)
  const cancel = () => void api.cancelQueuedMessage(pointer, message.id)

  // Released after a save has gone, so the message is sent as edited.
  const isEditing = editing !== null
  useEffect(() => {
    if (!isEditing) return
    void api.setQueuedMessageHeld(pointer, message.id, true)
    return () => void api.setQueuedMessageHeld(pointer, message.id, false)
  }, [isEditing, pointer.agent, pointer.agentSessionId, message.id])

  function save(text: string) {
    setEditing(null)
    if (discarding.current) return
    if (text.trim() === '' && message.images.length === 0) cancel()
    else if (text !== message.text) void api.editQueuedMessage(pointer, message.id, text.trim())
  }

  return (
    <div className="bg-muted/50 group flex items-start gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm">
      {editing === null ? (
        <p className="text-muted-foreground line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap" title="Queued until the turn ends">
          {message.images.length > 0 && (
            <ImageIcon className="mr-1 inline size-3.5 align-text-bottom" aria-label={`${message.images.length} images`} />
          )}
          {message.text}
        </p>
      ) : (
        <textarea
          value={editing}
          autoFocus
          onFocus={(event) => event.currentTarget.setSelectionRange(editing.length, editing.length)}
          onChange={(event) => setEditing(event.target.value)}
          onBlur={() => save(editing)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              save(editing)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              discarding.current = true
              setEditing(null)
            }
          }}
          className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent outline-none"
        />
      )}
      {editing === null && (
        <button
          type="button"
          title="Edit"
          onClick={() => {
            discarding.current = false
            setEditing(message.text)
          }}
          className="text-muted-foreground hover:text-foreground mt-0.5 opacity-0 group-hover:opacity-100"
        >
          <PencilIcon className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        title="Cancel"
        // Keeps an edit from saving on blur before the message is cancelled.
        onMouseDown={(event) => event.preventDefault()}
        onClick={cancel}
        className="text-muted-foreground hover:text-foreground mt-0.5 opacity-0 group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
