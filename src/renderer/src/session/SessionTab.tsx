import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParentTabState, useParentWorkspace, type WorkspaceNode } from 'react-resizable-panels'
import type { SessionPointer, SessionStatus } from '../../../shared/agent'
import { api } from '../api'
import { useProject } from '../project-context'
import { useSession, useSessionSummary, useSettingChoices } from '../sessions'
import { createSessionTab, type Tab, type TabData } from '../tabs'
import { BackgroundTasks } from './BackgroundTasks'
import { Composer } from './Composer'
import { FileLinksProvider } from './FileLinks'
import { QueuedMessages } from './QueuedMessages'
import { Requests } from './Requests'
import { SessionControls } from './SessionControls'
import { Transcript } from './Transcript'

export function SessionTab({ tab, pointer }: { tab: Tab; pointer: SessionPointer }) {
  const project = useProject()
  const session = useSession(project.id, pointer)
  const choices = useSettingChoices(project.id, pointer.agent)
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

  const movedTo = session?.movedTo
  useEffect(() => {
    if (!movedTo || !workspace) return
    // The tab follows the conversation, in its place.
    const visit = (node: WorkspaceNode<TabData>) => {
      if (node.type === 'split') {
        node.children.forEach(visit)
        return
      }
      const index = node.tabs.findIndex((other) => other.id === tab.id)
      if (index === -1) return
      workspace.addTab(createSessionTab({ agent: pointer.agent, agentSessionId: movedTo }, ''), {
        tabsetId: node.id,
        index,
        select: node.selectedId === tab.id,
      })
      workspace.closeTab(tab.id)
    }
    const model = workspace.getModel()
    visit(model.root)
    model.floating?.forEach(visit)
  }, [movedTo, workspace, tab.id, pointer.agent])

  if (!session) return null
  const { view } = session
  const working = view.status === 'working'

  return (
    <div className="flex h-full flex-col">
      <FileLinksProvider working={working}>
        <Transcript items={view.items} working={working} />
      </FileLinksProvider>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
        <StatusLine status={view.status} error={view.error} />
        <BackgroundTasks tasks={view.tasks} pointer={pointer} />
        <Requests requests={view.requests} pointer={pointer} />
        <QueuedMessages queued={view.queued} pointer={pointer} />
        <Composer
          projectId={project.id}
          pointer={pointer}
          initialDraft={session.draft}
          working={working}
          autoFocus={tabVisible}
          settings={view.settings}
          choices={choices}
        >
          <SessionControls
            pointer={pointer}
            settings={view.settings}
            choices={choices}
            usage={view.usage}
            working={working}
          />
        </Composer>
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
