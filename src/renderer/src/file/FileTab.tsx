import { useParentWorkspace } from 'react-resizable-panels'
import { createCommitTab, createProcessTab, type Tab, type TabData } from '../tabs'
import { FileView } from './FileView'

type FileTabData = Extract<TabData, { kind: 'file' }>

export function FileTab({ tab, data }: { tab: Tab; data: FileTabData }) {
  const { path, scrollPos, cursor, blame = false } = data
  const workspace = useParentWorkspace<TabData>()
  return (
    <FileView
      path={path}
      position={{ scrollPos, cursor }}
      blame={blame}
      onPositionChanged={(position) => workspace?.updateTab(tab.id, { data: { ...data, ...position } })}
      onBlameChange={(on) => workspace?.updateTab(tab.id, { data: { ...data, blame: on } })}
      onOpenCommit={(commit) => workspace?.addTab(createCommitTab(commit))}
      onProcessStarted={(process) => workspace?.addTab(createProcessTab(process))}
    />
  )
}
