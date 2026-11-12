import { PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  normalizeWorkspaceModel,
  Separator,
  TabCloseButton,
  Workspace,
  type WorkspaceClassNames,
  type WorkspaceModelInput,
  useParentTabset,
  useWorkspaceRef,
} from 'react-resizable-panels'
import type { Project } from '../../shared/api'
import { api } from './api'
import { modifierLabel, useShortcut } from './shortcuts'
import { createEmptyTab, type Tab, TabContent, type TabData } from './tabs'

const emptyModel: WorkspaceModelInput<TabData> = {
  version: 1,
  root: { type: 'tabset', tabs: [] },
}

/**
 * The tab area of one project. Mounted only while its project is active; the
 * layout is loaded on mount and saved on every change.
 */
export function ProjectWorkspace({ project }: { project: Project }) {
  const [model, setModel] = useState<WorkspaceModelInput<TabData> | null>(null)
  const workspaceRef = useWorkspaceRef<TabData>()

  useEffect(() => {
    let cancelled = false
    void api.loadLayout(project.id).then((saved) => {
      if (!cancelled) setModel(normalizeWorkspaceModel<TabData>(saved) ?? emptyModel)
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  useShortcut('t', () => workspaceRef.current?.addTab(createEmptyTab()))

  if (!model) return null

  return (
    <Workspace<TabData>
      className="h-full"
      classNames={classNames}
      defaultModel={model}
      workspaceRef={workspaceRef}
      onModelChanged={(changed) => void api.saveLayout(project.id, changed)}
      renderTabContent={renderTabContent}
      renderTab={renderTab}
      renderTabsetToolbar={renderToolbar}
      renderSeparator={renderSeparator}
      renderEmptyTabset={renderEmpty}
      tabRemovalSelectionBehavior="recent"
    />
  )
}

const classNames: WorkspaceClassNames = {
  tabset: 'flex h-full flex-col',
  header: 'flex h-9 shrink-0 bg-chrome',
  tabList: 'flex min-w-0 flex-1 overflow-x-auto',
  tabPanels: 'relative min-h-0 flex-1 bg-background',
  tabContent: 'h-full',
  toolbar: 'flex items-center px-1',
  dropIndicator: 'rounded-md border border-ring/60 bg-ring/15 transition-[inset] duration-150',
  dragPreview: 'rounded-md bg-popover px-3 py-1.5 shadow-lg',
}

function renderTabContent(tab: Tab) {
  return <TabContent tab={tab} />
}

function renderTab(tab: Tab, props: React.HTMLAttributes<HTMLElement>) {
  return (
    <div
      {...props}
      className={`${props.className ?? ''} group text-muted-foreground hover:text-foreground data-[tab-selected]:bg-background data-[tab-selected]:text-foreground flex max-w-56 cursor-default items-center gap-1 pr-1 pl-3`}
    >
      <span className="truncate">{tab.title}</span>
      <TabCloseButton className="hover:bg-accent invisible flex size-5 items-center justify-center rounded group-hover:visible group-data-[tab-selected]:visible">
        <XIcon className="size-3.5" />
      </TabCloseButton>
    </div>
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
