import type { TabNode } from 'react-resizable-panels'
import type { SessionPointer } from '../../shared/agent'
import { NewTabPage } from './NewTabPage'
import { SessionTab } from './session/SessionTab'

/**
 * What a tab shows. Saved in the project's layout, so must stay JSON-serialisable
 * and tolerate kinds written by newer versions.
 */
export type TabData = { kind: 'empty' } | ({ kind: 'session' } & SessionPointer)

export type Tab = TabNode<TabData>

export function createEmptyTab(): Tab {
  return { id: crypto.randomUUID(), title: 'New tab', data: { kind: 'empty' } }
}

/** One tab per session: adding a session tab that is already open selects it instead. */
export function createSessionTab(pointer: SessionPointer, title: string): Tab {
  return {
    id: `session:${pointer.agentSessionId}`,
    title: title || 'New session',
    data: { kind: 'session', ...pointer },
  }
}

export function TabContent({ tab }: { tab: Tab }) {
  const data = tab.data
  switch (data.kind) {
    case 'empty':
      return <NewTabPage tab={tab} />
    case 'session':
      return <SessionTab tab={tab} pointer={{ agent: data.agent, agentSessionId: data.agentSessionId }} />
    default:
      return <Centred>This version can't show “{(data as { kind: string }).kind}” tabs.</Centred>
  }
}

export function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">{children}</div>
  )
}
