import { FileDiffIcon, GitCommitHorizontalIcon, PlusIcon, XIcon } from 'lucide-react'
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  Group,
  normalizeWorkspaceModel,
  Panel,
  Separator,
  TabCloseButton,
  Workspace,
  type WorkspaceClassNames,
  type WorkspaceModel,
  type WorkspaceModelInput,
  type WorkspaceNode,
  useDefaultLayout,
  useParentTabset,
  useParentWorkspace,
  usePanelRef,
  useWorkspaceRef,
} from 'react-resizable-panels'
import type { SessionTarget } from '../../shared/agent'
import type { Project } from '../../shared/api'
import { api } from './api'
import { FileTree } from './FileTree'
import { FileActionsProvider, useFileActions } from './file-actions'
import { diffSide } from './git/DiffTab'
import { GitStatusRow } from './git/GitStatusRow'
import { tabsetsIn } from './layout-tree'
import { ProjectContext } from './project-context'
import { SessionIndicator } from './session/SessionIndicator'
import { useSessionSummary } from './sessions'
import { modifierLabel, useShortcut } from './shortcuts'
import { ProcessList } from './process/ProcessList'
import { ProcessStatusDot } from './process/ProcessStatusDot'
import { useProcess } from './processes'
import { TabErrorBoundary } from './TabErrorBoundary'
import {
  createDiffTab,
  createEmptyTab,
  createFileTab,
  createGitTab,
  createProcessTab,
  createSessionTab,
  type Tab,
  TabContent,
  type TabData,
} from './tabs'

const emptyModel: WorkspaceModelInput<TabData> = {
  version: 1,
  root: { type: 'tabset', tabs: [] },
}

/** What the rest of the window can do in the active project's tabs. */
export type ProjectWorkspaceHandle = { openFile: (path: string) => void }

/** A session to show once the project's tabs have loaded. */
export type PendingSession = SessionTarget

type Props = {
  project: Project
  pendingSession: PendingSession | null
  onPendingSessionShown: () => void
  ref?: Ref<ProjectWorkspaceHandle>
}

/**
 * The file tree and tab area of one project. Mounted only while its project is
 * active; the tab layout is loaded on mount and saved on every change.
 */
export function ProjectWorkspace({ project, pendingSession, onPendingSessionShown, ref }: Props) {
  const [model, setModel] = useState<WorkspaceModelInput<TabData> | null>(null)
  const workspaceRef = useWorkspaceRef<TabData>()
  useImperativeHandle(ref, () => ({ openFile: (path) => workspaceRef.current?.addTab(createFileTab(path)) }), [workspaceRef])
  const openTabs = useRef(new Map<string, TabData>())
  const sidebarRef = usePanelRef()
  // The sidebar's width is shared by all projects.
  const sidebarLayout = useDefaultLayout({ id: 'sidebar', storage: localStorage })

  useEffect(() => {
    let cancelled = false
    void api.loadLayout(project.id).then((saved) => {
      if (cancelled) return
      const normalized = normalizeWorkspaceModel<TabData>(saved)
      openTabs.current = normalized ? tabsIn(normalized) : new Map()
      setModel(normalized ?? emptyModel)
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  // Runs after the workspace has mounted, so its handle is set. Session tabs
  // have stable ids, so this selects an open tab or adds a missing one.
  useEffect(() => {
    if (!model || pendingSession?.projectId !== project.id) return
    workspaceRef.current?.addTab(createSessionTab(pendingSession.pointer, pendingSession.title))
    onPendingSessionShown()
  }, [model, pendingSession, project.id, workspaceRef, onPendingSessionShown])

  useShortcut('t', () => workspaceRef.current?.addTab(createEmptyTab()))
  useShortcut('b', () => {
    const sidebar = sidebarRef.current
    if (sidebar?.isCollapsed()) sidebar.expand()
    else sidebar?.collapse()
  })

  if (!model) return null

  const openFile = (path: string) => workspaceRef.current?.addTab(createFileTab(path))

  return (
    <ProjectContext.Provider value={project}>
      <FileActionsProvider workspaceRef={workspaceRef} openFile={openFile}>
        <NewFileShortcut />
        <Group
          orientation="horizontal"
          className="h-full"
          defaultLayout={sidebarLayout.defaultLayout}
          onLayoutChanged={sidebarLayout.onLayoutChanged}
        >
          <Panel
            id="files"
            panelRef={sidebarRef}
            defaultSize={260}
            minSize={160}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            className="bg-chrome"
          >
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <FileTree
                  onOpenFile={openFile}
                  onOpenDiff={(request) => workspaceRef.current?.addTab(createDiffTab(request))}
                />
              </div>
              <ProcessList onOpen={(process) => workspaceRef.current?.addTab(createProcessTab(process))} />
              <GitStatusRow onOpen={() => workspaceRef.current?.addTab(createGitTab())} />
            </div>
          </Panel>
          {renderSeparator()}
          <Panel id="tabs">
            <Workspace<TabData>
              className="h-full"
              classNames={classNames}
              defaultModel={model}
              workspaceRef={workspaceRef}
              onModelChanged={(changed) => {
                void api.saveLayout(project.id, changed)
                // Closing a tab releases what it runs. Unmounting isn't the signal,
                // since switching projects unmounts every tab.
                const tabs = tabsIn(changed)
                for (const [id, data] of openTabs.current) {
                  if (!tabs.has(id)) release(project.id, id, data)
                }
                openTabs.current = tabs
              }}
              renderTabContent={renderTabContent}
              renderTab={renderTab}
              renderTabsetToolbar={renderToolbar}
              renderSeparator={renderSeparator}
              renderEmptyTabset={renderEmpty}
              tabRemovalSelectionBehavior="recent"
            />
          </Panel>
        </Group>
      </FileActionsProvider>
    </ProjectContext.Provider>
  )
}

function NewFileShortcut() {
  const actions = useFileActions()
  useShortcut('n', () => actions.newFile(''))
  return null
}

function tabsIn(model: WorkspaceModel<TabData>): Map<string, TabData> {
  return new Map([...tabsetsIn(model)].flatMap((tabset) => tabset.tabs.map((tab) => [tab.id, tab.data] as const)))
}

function release(projectId: string, tabId: string, data: TabData): void {
  if (data.kind === 'session') void api.closeSession({ agent: data.agent, agentSessionId: data.agentSessionId })
  else if (data.kind === 'terminal') void api.closeTerminal(projectId, tabId)
}

const classNames: WorkspaceClassNames = {
  tabset: 'flex h-full flex-col',
  header: 'flex min-h-9 shrink-0 bg-chrome',
  tabList: 'flex min-w-0 flex-1 flex-wrap',
  tabPanels: 'relative min-h-0 flex-1 bg-background',
  tabContent: 'h-full',
  toolbar: 'flex h-9 items-center px-1',
  dropIndicator: 'rounded-md border border-ring/60 bg-ring/15 transition-[inset] duration-150',
  dragPreview: 'rounded-md bg-popover px-3 py-1.5 shadow-lg',
}

function renderTabContent(tab: Tab) {
  return (
    <TabErrorBoundary>
      <TabContent tab={tab} />
    </TabErrorBoundary>
  )
}

function renderTab(tab: Tab, props: React.HTMLAttributes<HTMLElement>) {
  return <TabHeader tab={tab} props={props} />
}

function TabHeader({ tab, props }: { tab: Tab; props: React.HTMLAttributes<HTMLElement> }) {
  const workspace = useParentWorkspace<TabData>()
  return (
    <div
      {...props}
      onAuxClick={(event) => {
        props.onAuxClick?.(event)
        if (event.button === 1) workspace?.closeTab(tab.id)
      }}
      className={`${props.className ?? ''} group text-muted-foreground hover:text-foreground data-[tab-selected]:bg-background data-[tab-selected]:text-foreground flex h-9 max-w-56 cursor-default items-center gap-1.5 pr-1 pl-3`}
    >
      {tab.data.kind === 'session' ? (
        <SessionTabLabel tab={tab} agentSessionId={tab.data.agentSessionId} />
      ) : tab.data.kind === 'file' ? (
        <span className="truncate" title={tab.data.path}>
          {tab.title}
        </span>
      ) : tab.data.kind === 'process' ? (
        <ProcessTabLabel tab={tab} processId={tab.data.processId} />
      ) : tab.data.kind === 'diff' ? (
        <>
          <FileDiffIcon aria-label="Changes in" className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate" title={`${tab.data.path} (${diffSide(tab.data).toLowerCase()})`}>
            {tab.title}
          </span>
        </>
      ) : tab.data.kind === 'commit' ? (
        <>
          <GitCommitHorizontalIcon aria-label="Commit" className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate font-mono text-xs" title={tab.data.hash}>
            {tab.title}
          </span>
        </>
      ) : (
        <span className="truncate">{tab.title}</span>
      )}
      <TabCloseButton className="hover:bg-accent invisible flex size-5 items-center justify-center rounded group-hover:visible group-data-[tab-selected]:visible">
        <XIcon className="size-3.5" />
      </TabCloseButton>
    </div>
  )
}

function SessionTabLabel({ tab, agentSessionId }: { tab: Tab; agentSessionId: string }) {
  const summary = useSessionSummary(agentSessionId)
  return (
    <>
      <SessionIndicator summary={summary} />
      <span className="truncate">{summary?.title || tab.title}</span>
    </>
  )
}

function ProcessTabLabel({ tab, processId }: { tab: Tab; processId: string }) {
  const process = useProcess(processId)
  return (
    <>
      {process && <ProcessStatusDot process={process} />}
      <span className="truncate font-mono text-xs">{tab.title}</span>
    </>
  )
}

function renderToolbar() {
  return <NewTabButton />
}

function NewTabButton() {
  const tabset = useParentTabset<TabData>()
  return (
    <button
      type="button"
      title={`New tab (${modifierLabel}T)`}
      className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 items-center justify-center rounded"
      onClick={() => tabset?.addTab(createEmptyTab())}
    >
      <PlusIcon className="size-4" />
    </button>
  )
}

function renderSeparator() {
  return <Separator className="bg-border aria-[orientation=horizontal]:h-px aria-[orientation=vertical]:w-px data-[separator=hover]:bg-ring data-[separator=active]:bg-ring" />
}

function renderEmpty() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">
      Press {modifierLabel}T to open a tab
    </div>
  )
}
