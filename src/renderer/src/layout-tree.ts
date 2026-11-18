import type { WorkspaceModel, WorkspaceNode } from 'react-resizable-panels'

type Tabset<T> = Exclude<WorkspaceNode<T>, { type: 'split' }>

function* tabsetsUnder<T>(node: WorkspaceNode<T>): Generator<Tabset<T>> {
  if (node.type !== 'split') yield node as Tabset<T>
  else for (const child of node.children) yield* tabsetsUnder(child)
}

/** Every tabset in a layout, floating ones included. */
export function* tabsetsIn<T>(model: WorkspaceModel<T>): Generator<Tabset<T>> {
  yield* tabsetsUnder(model.root)
  for (const node of model.floating ?? []) yield* tabsetsUnder(node)
}
