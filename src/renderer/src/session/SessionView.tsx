import { useEffect, useState } from 'react'
import type { SessionPointer, SessionStatus } from '../../../shared/agent'
import { api } from '../api'
import { useProject } from '../project-context'
import { useSession, useSettingChoices } from '../sessions'
import { BackgroundTasks } from './BackgroundTasks'
import { Composer } from './Composer'
import { FileLinksProvider } from './FileLinks'
import { QueuedMessages } from './QueuedMessages'
import { Requests } from './Requests'
import { SessionControls } from './SessionControls'
import { Transcript } from './Transcript'
import { UsageLimitReached } from './UsageLimitReached'

/**
 * A session's transcript and composer, wherever it is shown. `shown` says
 * whether its tab or screen is on display; `onMoved` is told the session the
 * conversation continues in after the agent resets it.
 */
export function SessionView({ pointer, shown, autoFocus = false, onMoved, onOpenFile }: {
  pointer: SessionPointer
  shown: boolean
  autoFocus?: boolean
  onMoved: (agentSessionId: string) => void
  onOpenFile: (path: string) => void
}) {
  const project = useProject()
  const session = useSession(project.id, pointer)
  const choices = useSettingChoices(project.id, pointer.agent)
  const pageViewed = usePageViewed()
  const loaded = session !== null
  const visible = loaded && shown && pageViewed

  useEffect(() => {
    if (loaded) void api.setSessionVisible(pointer, visible)
  }, [loaded, visible, pointer.agent, pointer.agentSessionId])

  const movedTo = session?.movedTo
  useEffect(() => {
    if (movedTo) onMoved(movedTo)
  }, [movedTo, onMoved])

  if (!session) return null
  const { view } = session
  const working = view.status === 'working'

  return (
    <div className="flex h-full flex-col">
      <FileLinksProvider onOpenFile={onOpenFile}>
        {/* Waiting on the user isn't working, so the spinner stops for a request. */}
        <Transcript
          items={view.items}
          working={working && view.requests.length === 0}
          onEdit={working || view.requests.length > 0 ? undefined : (itemId, text) => api.editMessage(pointer, itemId, text)}
        />
      </FileLinksProvider>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4 compact:px-2 compact:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <StatusLine status={view.status} error={view.error} />
        <BackgroundTasks tasks={view.tasks} pointer={pointer} />
        <Requests requests={view.requests} pointer={pointer} />
        <UsageLimitReached limits={view.limits} queued={view.queued} working={working} pointer={pointer} />
        <QueuedMessages queued={view.queued} pointer={pointer} />
        <Composer
          projectId={project.id}
          pointer={pointer}
          initialDraft={session.draft}
          working={working}
          suggestion={view.suggestion}
          sent={view.items.flatMap((item) => (item.kind === 'userMessage' ? [item.text] : []))}
          autoFocus={autoFocus}
          settings={view.settings}
          choices={choices}
        >
          <SessionControls
            pointer={pointer}
            settings={view.settings}
            choices={choices}
            usage={view.usage}
            limits={view.limits}
            working={working}
          />
        </Composer>
      </div>
    </div>
  )
}

function StatusLine({ status, error }: { status: SessionStatus; error?: string }) {
  if (status !== 'errored') return null
  return <div className="text-destructive text-sm">The agent stopped: {error}</div>
}

/** A backgrounded phone tab stops counting at once, before its socket drops. */
function usePageViewed(): boolean {
  const isViewed = () => document.hasFocus() && document.visibilityState === 'visible'
  const [viewed, setViewed] = useState(isViewed)
  useEffect(() => {
    const update = () => setViewed(isViewed())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return viewed
}
