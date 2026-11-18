import { useCallback, useEffect } from 'react'
import { useParentTabState, useParentWorkspace, type WorkspaceNode } from 'react-resizable-panels'
import type { SessionPointer } from '../../../shared/agent'
import { useSessionSummary } from '../sessions'
import { createSessionTab, type Tab, type TabData } from '../tabs'
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
  }, [workspace, tab.id, pointer.agent])

  return <SessionView pointer={pointer} shown={shown} onMoved={followConversation} />
}
