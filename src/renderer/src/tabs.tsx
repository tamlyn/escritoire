import type { TabNode } from 'react-resizable-panels'
import type { SessionPointer } from '../../shared/agent'
import { baseName } from '../../shared/files'
import { FileTab } from './file/FileTab'
import { NewTabPage } from './NewTabPage'
import { SessionTab } from './session/SessionTab'
import { TerminalTab } from './terminal/TerminalTab'

/**
 * What a tab shows. Saved in the project's layout, so must stay JSON-serialisable
 * and tolerate kinds written by newer versions.
 */
export type TabData =
  | { kind: 'empty' }
  | ({ kind: 'session' } & SessionPointer)
  /** `scrollPos` is the document position of the top line. */
  | { kind: 'file'; path: string; scrollPos?: number }
  /** The tab's id identifies its shell in main. */
  | { kind: 'terminal' }

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

/** One tab per file, like sessions. */
export function createFileTab(path: string): Tab {
  return { id: `file:${path}`, title: baseName(path), data: { kind: 'file', path } }
}

export function createTerminalTab(): Tab {
  return { id: `terminal:${crypto.randomUUID()}`, title: 'Terminal', data: { kind: 'terminal' } }
}

export function TabContent({ tab }: { tab: Tab }) {
  const data = tab.data
  switch (data.kind) {
    case 'empty':
      return <NewTabPage tab={tab} />
    case 'session':
      return <SessionTab tab={tab} pointer={{ agent: data.agent, agentSessionId: data.agentSessionId }} />
    case 'file':
      return <FileTab tab={tab} path={data.path} scrollPos={data.scrollPos} />
    case 'terminal':
      return <TerminalTab tab={tab} />
    default:
      return <Centred>This version can't show “{(data as { kind: string }).kind}” tabs.</Centred>
  }
}

export function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">{children}</div>
  )
}
