import { type ComponentProps, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParentWorkspace } from 'react-resizable-panels'
import { defaultComponents, defaultRemarkPlugins, type ExtraProps } from 'streamdown'
import { api } from '../api'
import { revealLine } from '../file/reveal'
import { useProject } from '../project-context'
import { createFileTab, type TabData } from '../tabs'
import { type FileRef, parseFileHref, remarkFileLinks } from './file-refs'

type FileLinks = {
  /** The path to open, or `null` if a path found in text isn't one of the project's files. */
  resolve: (ref: FileRef, detected: boolean) => string | null
  open: (path: string, line: number | undefined) => void
}

const FileLinksContext = createContext<FileLinks | null>(null)

/**
 * Lets links in agent messages open files. `working` refreshes the project's
 * file list as turns start and end, so files an agent creates link too.
 */
export function FileLinksProvider({ working, children }: { working: boolean; children: React.ReactNode }) {
  const project = useProject()
  const workspace = useParentWorkspace<TabData>()
  const [files, setFiles] = useState<Set<string> | null>(null)

  useEffect(() => {
    let current = true
    void api.listProjectFiles(project.id).then((list) => current && setFiles(new Set(list)), console.error)
    return () => { current = false }
  }, [project.id, working])

  const links = useMemo((): FileLinks => {
    const root = project.path.replace(/\/$/, '')
    return {
      resolve(ref, detected) {
        let path = ref.path.replace(/^\.\//, '')
        if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1)
        // Absolute paths are unambiguous; relative ones in prose often aren't paths at all.
        if (detected && !path.startsWith('/') && !files?.has(path)) return null
        return path
      },
      open(path, line) {
        workspace?.addTab(createFileTab(path))
        // After the tab is shown, so an editor that was already open can scroll.
        if (line) requestAnimationFrame(() => revealLine(project.id, path, line))
      },
    }
  }, [project.id, project.path, files, workspace])

  return <FileLinksContext.Provider value={links}>{children}</FileLinksContext.Provider>
}

const DefaultLink = defaultComponents.a!

function MessageLink(props: ComponentProps<'a'> & ExtraProps) {
  const links = useContext(FileLinksContext)
  const ref = props.href ? parseFileHref(props.href) : null
  if (!ref) return <DefaultLink {...props} />
  const path = links?.resolve(ref, ref.detected)
  if (!links || !path) return <>{props.children}</>
  return (
    <a
      href="#"
      title={ref.line ? `${path}:${ref.line}` : path}
      onClick={(event) => {
        event.preventDefault()
        links.open(path, ref.line)
      }}
      className="text-primary wrap-anywhere hover:underline"
    >
      {props.children}
    </a>
  )
}

/** Streamdown props for a message whose file paths open the editor. */
export const fileLinkProps = {
  remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkFileLinks],
  components: { a: MessageLink },
}
