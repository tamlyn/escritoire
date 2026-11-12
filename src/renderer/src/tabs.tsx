import type { TabNode } from 'react-resizable-panels'

/**
 * What a tab shows. Saved in the project's layout, so must stay JSON-serialisable
 * and tolerate kinds written by newer versions.
 */
export type TabData = { kind: 'empty' }

export type Tab = TabNode<TabData>

export function createEmptyTab(): Tab {
  return { id: crypto.randomUUID(), title: 'New tab', data: { kind: 'empty' } }
}

export function TabContent({ tab }: { tab: Tab }) {
  const kind: string = tab.data.kind
  switch (kind) {
    case 'empty':
      return <Centred>Nothing here yet</Centred>
    default:
      return <Centred>This version can't show “{kind}” tabs.</Centred>
  }
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">{children}</div>
  )
}
