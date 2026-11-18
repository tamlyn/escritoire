import { useMemo } from 'react'
import type { ProcessInfo } from '../../../shared/process'
import { isSqlFile } from '../../../shared/sql'
import { api } from '../api'
import { useFileContent } from '../files'
import { useProcesses } from '../processes'
import { useProject } from '../project-context'
import { Centred } from '../tabs'
import { Editor, type EditorProps } from './FileEditor'
import { SqlFile } from './sql/SqlFile'

type Props = Pick<EditorProps, 'onScrolled' | 'blame' | 'onBlameChange' | 'onOpenCommit'> & {
  path: string
  scrollPos: number | undefined
  onProcessStarted: (process: ProcessInfo) => void
}

/** A project file in its editor, wherever it is shown. */
export function FileView({ path, scrollPos, onProcessStarted, ...editorProps }: Props) {
  const project = useProject()
  const content = useFileContent(project.id, path)
  const processes = useProcesses(project.id)
  const runningTasks = useMemo(
    () => processes.filter((p) => p.status === 'running' && p.task?.file === path).map((p) => p.task!.name),
    [processes, path],
  )

  async function runTask(name: string) {
    onProcessStarted(await api.startProcess(project.id, { task: { file: path, name } }))
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
          {...editorProps}
          projectId={project.id}
          path={path}
          content={content}
          initialScrollPos={scrollPos}
          onRunTask={(name) => void runTask(name)}
          runningTasks={runningTasks}
        />
      )
      return isSqlFile(path) ? <SqlFile path={path} renderEditor={editor} /> : editor()
    }
  }
}
