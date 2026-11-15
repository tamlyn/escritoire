import { useMemo } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import { isSqlFile } from '../../../shared/sql'
import { api } from '../api'
import { useFileContent } from '../files'
import { useProcesses } from '../processes'
import { useProject } from '../project-context'
import { Centred, createCommitTab, createProcessTab, type Tab, type TabData } from '../tabs'
import { Editor, type EditorProps } from './FileEditor'
import { SqlFile } from './sql/SqlFile'

type FileTabData = Extract<TabData, { kind: 'file' }>

export function FileTab({ tab, data }: { tab: Tab; data: FileTabData }) {
  const { path, scrollPos, blame = false } = data
  const project = useProject()
  const content = useFileContent(project.id, path)
  const workspace = useParentWorkspace<TabData>()
  const processes = useProcesses(project.id)
  const runningTasks = useMemo(
    () => processes.filter((p) => p.status === 'running' && p.task?.file === path).map((p) => p.task!.name),
    [processes, path],
  )

  async function runTask(name: string) {
    const process = await api.startProcess(project.id, { task: { file: path, name } })
    workspace?.addTab(createProcessTab(process))
  }

  if (!content) return null
  switch (content.kind) {
    case 'missing':
      return <Centred>{path} doesn't exist.</Centred>
    case 'binary':
      return <Centred>{path} is a binary file.</Centred>
    case 'notUtf8':
      return <Centred>{path} isn't UTF-8 text, so it can't be edited here.</Centred>
    case 'tooLarge':
      return <Centred>{path} is too large to open ({(content.size / 1024 / 1024).toFixed(1)} MB).</Centred>
    case 'text': {
      const editor = (sql?: Pick<EditorProps, 'extensions' | 'viewRef'>) => (
        <Editor
          {...sql}
          projectId={project.id}
          path={path}
          content={content}
          initialScrollPos={scrollPos}
          onScrolled={(pos) => workspace?.updateTab(tab.id, { data: { ...data, scrollPos: pos } })}
          onRunTask={(name) => void runTask(name)}
          runningTasks={runningTasks}
          blame={blame}
          onBlameChange={(on) => workspace?.updateTab(tab.id, { data: { ...data, blame: on } })}
          onOpenCommit={(commit) => workspace?.addTab(createCommitTab(commit))}
        />
      )
      return isSqlFile(path) ? <SqlFile path={path} renderEditor={editor} /> : editor()
    }
  }
}
