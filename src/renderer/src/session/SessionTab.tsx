import { ArrowUpIcon, LoaderCircleIcon, SquareIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParentTabState, useParentWorkspace } from 'react-resizable-panels'
import type { SessionPointer, SessionStatus } from '../../../shared/agent'
import { api } from '../api'
import { useProject } from '../project-context'
import { useSession, useSessionSummary } from '../sessions'
import type { Tab, TabData } from '../tabs'
import { Requests } from './Requests'
import { Transcript } from './Transcript'

const draftSaveDelayMs = 500

export function SessionTab({ tab, pointer }: { tab: Tab; pointer: SessionPointer }) {
  const project = useProject()
  const session = useSession(project.id, pointer)
  const summary = useSessionSummary(pointer.agentSessionId)
  const workspace = useParentWorkspace<TabData>()
  const tabVisible = useParentTabState()?.isVisible ?? false
  const windowFocused = useWindowFocused()
  const loaded = session !== null
  const visible = loaded && tabVisible && windowFocused

  useEffect(() => {
    if (loaded) void api.setSessionVisible(pointer, visible)
  }, [loaded, visible, pointer.agent, pointer.agentSessionId])

  const title = summary?.title
  useEffect(() => {
    if (title && title !== tab.title) workspace?.updateTab(tab.id, { title })
  }, [title, tab.id, tab.title, workspace])

  if (!session) return null
  const { view } = session

  return (
    <div className="flex h-full flex-col">
      <Transcript items={view.items} working={view.status === 'working'} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
        <StatusLine status={view.status} error={view.error} />
        <Requests requests={view.requests} pointer={pointer} />
        <Composer
          pointer={pointer}
          initialDraft={session.draft}
          working={view.status === 'working'}
          autoFocus={tabVisible}
        />
      </div>
    </div>
  )
}

function StatusLine({ status, error }: { status: SessionStatus; error?: string }) {
  if (status === 'working') {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircleIcon className="size-3.5 animate-spin" /> Working…
      </div>
    )
  }
  if (status === 'errored') {
    return <div className="text-destructive text-sm">The agent stopped: {error}</div>
  }
  return null
}

function Composer({
  pointer,
  initialDraft,
  working,
  autoFocus,
}: {
  pointer: SessionPointer
  initialDraft: string
  working: boolean
  autoFocus: boolean
}) {
  const [text, setText] = useState(initialDraft)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function changeText(next: string) {
    setText(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void api.saveDraft(pointer, next), draftSaveDelayMs)
  }

  function send() {
    const message = text.trim()
    if (!message) return
    clearTimeout(saveTimer.current)
    setText('')
    void api.sendMessage(pointer, message)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape' && working) {
      event.preventDefault()
      void api.interrupt(pointer)
    }
  }

  return (
    <div className="focus-within:ring-ring/50 bg-background flex items-end gap-2 rounded-xl border p-2 focus-within:ring-2">
      <textarea
        value={text}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        rows={1}
        placeholder={working ? 'Queue a message (Esc to interrupt)' : 'Message Claude'}
        className="placeholder:text-muted-foreground field-sizing-content max-h-60 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none"
      />
      {working && !text.trim() ? (
        <button
          type="button"
          title="Interrupt (Esc)"
          onClick={() => void api.interrupt(pointer)}
          className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
        >
          <SquareIcon className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          title="Send (Enter)"
          disabled={!text.trim()}
          onClick={send}
          className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40"
        >
          <ArrowUpIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return focused
}
