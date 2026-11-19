import { useCallback, useEffect } from 'react'
import { useParentTabState, useParentWorkspace } from 'react-resizable-panels'
import type { SessionPointer } from '../../../shared/agent'
import { tabsetsIn } from '../layout-tree'
import { useSessionClosed, useSessionSummary } from '../sessions'
import { createFileTab, createSessionTab, type Tab, type TabData } from '../tabs'
import { SessionView } from './SessionView'

export function SessionTab({ tab, pointer }: { tab: Tab; pointer: SessionPointer }) {
  const summary = useSessionSummary(pointer.agentSessionId)
  const workspace = useParentWorkspace<TabData>()
  const shown = useParentTabState()?.isVisible ?? false

  const title = summary?.title
  useEffect(() => {
    if (title && title !== tab.title) workspace?.updateTab(tab.id, { title })
  }, [title, tab.id, tab.title, workspace])

  const followConversation = useCallback((movedTo: string) => {
    if (!workspace) return
    // The tab follows the conversation, in its place.
    for (const tabset of tabsetsIn(workspace.getModel())) {
      const index = tabset.tabs.findIndex((other) => other.id === tab.id)
      if (index === -1) continue
      workspace.addTab(createSessionTab({ agent: pointer.agent, agentSessionId: movedTo }, ''), {
        tabsetId: tabset.id,
        index,
        select: tabset.selectedId === tab.id,
      })
      workspace.closeTab(tab.id)
    }
  }, [workspace, tab.id, pointer.agent])

  // Closed on another client, such as a phone.
  useSessionClosed(summary, () => workspace?.closeTab(tab.id))

  const openFile = useCallback((path: string) => workspace?.addTab(createFileTab(path)), [workspace])

  return <SessionView pointer={pointer} shown={shown} autoFocus={shown} onMoved={followConversation} onOpenFile={openFile} />
}
