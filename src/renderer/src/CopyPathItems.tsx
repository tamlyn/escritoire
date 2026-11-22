import { ContextMenuItem } from './components/ui/context-menu'
import { absolutePath, isOutsideProject } from './files'
import { useProject } from './project-context'

/** Context menu items copying a file's path. A file outside the project has no path relative to it. */
export function CopyPathItems({ path }: { path: string }) {
  const project = useProject()
  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(console.error)
  return (
    <>
      {!isOutsideProject(path) && <ContextMenuItem onSelect={() => copy(path)}>Copy relative path</ContextMenuItem>}
      <ContextMenuItem onSelect={() => copy(absolutePath(project.path, path))}>Copy absolute path</ContextMenuItem>
    </>
  )
}
