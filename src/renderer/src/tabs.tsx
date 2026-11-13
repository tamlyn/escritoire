import type { TabNode } from 'react-resizable-panels'
import type { SessionPointer } from '../../shared/agent'
import { baseName } from '../../shared/files'
import type { GitDiffRequest } from '../../shared/git'
import type { ProcessInfo, TaskRef } from '../../shared/process'
import { ProcessTab } from './process/ProcessTab'
import { FileTab } from './file/FileTab'
import { DiffTab } from './git/DiffTab'
import { GitTab } from './git/GitTab'
import { NewTabPage } from './NewTabPage'
import { SessionTab } from './session/SessionTab'
import { TerminalTab } from './screen/TerminalTab'

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
  /** Enough to start the process again after a restart. */
  | { kind: 'process'; processId: string; command: string; cwd: string; task?: TaskRef }
  | { kind: 'git' }
  | ({ kind: 'diff' } & GitDiffRequest)

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

/** One tab per process. */
export function createProcessTab(process: ProcessInfo): Tab {
  return {
    id: `process:${process.id}`,
    title: process.command,
    data: {
      kind: 'process',
      processId: process.id,
      command: process.command,
      cwd: process.cwd,
      ...(process.task ? { task: process.task } : {}),
    },
  }
}

/** One per project. */
export function createGitTab(): Tab {
  return { id: 'git', title: 'Git', data: { kind: 'git' } }
}

/** One per file and side, so a file's staged and unstaged changes can be open together. */
export function createDiffTab({ path, staged, from }: GitDiffRequest): Tab {
  return {
    id: `diff:${staged ? 'staged' : 'unstaged'}:${path}`,
    title: baseName(path),
    data: { kind: 'diff', path, staged, ...(from ? { from } : {}) },
  }
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
    case 'process':
      return <ProcessTab processId={data.processId} command={data.command} cwd={data.cwd} task={data.task} />
    case 'git':
      return <GitTab />
    case 'diff':
      return <DiffTab path={data.path} staged={data.staged} from={data.from} />
    default:
      return <Centred>This version can't show “{(data as { kind: string }).kind}” tabs.</Centred>
  }
}

export function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">{children}</div>
  )
}
