import { useParentWorkspace } from 'react-resizable-panels'
import { useProject } from '../project-context'
import { Centred, createCommitTab, createDiffTab, type TabData } from '../tabs'
import { ChangeGroup } from './ChangeGroup'
import { errorMessage, useGitCommit } from './git'
import { RefLabels } from './RefLabels'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** One commit: its message and the files it changed, each opening its diff. */
export function CommitTab({ hash }: { hash: string }) {
  const project = useProject()
  const commit = useGitCommit(project.id, hash)
  const workspace = useParentWorkspace<TabData>()

  if (commit === undefined) return null
  if (commit instanceof Error) return <Centred>Couldn't load commit {hash.slice(0, 7)}: {errorMessage(commit)}</Centred>

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6 text-sm">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <RefLabels refs={commit.refs} />
          </div>
          <h1 className="font-medium">{commit.subject}</h1>
          {commit.body && <p className="whitespace-pre-wrap">{commit.body}</p>}
          <p className="text-muted-foreground text-xs">
            {commit.author}, {dateFormat.format(commit.at)}
          </p>
          <p className="text-muted-foreground flex flex-wrap gap-x-3 font-mono text-xs">
            <span title="Commit" className="select-text">
              {commit.hash}
            </span>
            {commit.parents.map((parent) => (
              <button
                key={parent}
                type="button"
                title="Show the parent commit"
                className="hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => workspace?.addTab(createCommitTab({ hash: parent, shortHash: parent.slice(0, 7) }))}
              >
                parent {parent.slice(0, 7)}
              </button>
            ))}
          </p>
        </header>
        {commit.changes.length === 0 && <p className="text-muted-foreground">No changes in this project.</p>}
        <ChangeGroup
          title="Files"
          changes={commit.changes}
          onOpen={(change) =>
            workspace?.addTab(
              createDiffTab({
                path: change.path,
                staged: false,
                commit: commit.hash,
                ...(change.from ? { from: change.from } : {}),
              }),
            )
          }
        />
      </div>
    </div>
  )
}
