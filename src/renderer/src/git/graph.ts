/** A line within one row, in lane units across and row units down (0 top, 0.5 middle, 1 bottom). */
export type GraphLine = { x1: number; y1: number; x2: number; y2: number; colour: number }

export type GraphRow = { lane: number; colour: number; lines: GraphLine[] }

export type Graph = { rows: GraphRow[]; width: number }

type Lane = { hash: string; colour: number } | null

/**
 * Places each commit in a lane, as `git log --graph` does. Commits must be in
 * topological order, newest first. A lane carries a line down to the commit it
 * is waiting for; lanes never move sideways, so a row's lines are straight
 * except where they join or leave its commit.
 */
export function layoutGraph(commits: { hash: string; parents: string[] }[]): Graph {
  let lanes: Lane[] = []
  let nextColour = 0
  let width = 0
  const rows: GraphRow[] = []

  for (const commit of commits) {
    let lane = lanes.findIndex((l) => l?.hash === commit.hash)
    // A branch tip: nothing above leads here.
    const tip = lane === -1
    if (tip) {
      lane = firstFree(lanes)
      lanes[lane] = { hash: commit.hash, colour: nextColour++ }
    }
    const colour = lanes[lane]!.colour
    const lines: GraphLine[] = []

    const next = lanes.map((l) => (l?.hash === commit.hash ? null : l))
    const [first, ...others] = commit.parents
    next[lane] = first ? { hash: first, colour } : null
    for (const parent of others) {
      if (!next.some((l) => l?.hash === parent)) next[firstFree(next)] = { hash: parent, colour: nextColour++ }
    }

    lanes.forEach((l, i) => {
      if (!l || (tip && i === lane)) return
      if (l.hash === commit.hash) lines.push({ x1: i, y1: 0, x2: lane, y2: 0.5, colour: l.colour })
      else lines.push({ x1: i, y1: 0, x2: i, y2: 1, colour: l.colour })
    })
    for (const [i, parent] of commit.parents.entries()) {
      // The first parent continues this lane, even if another lane waits for it too.
      const target = i === 0 ? lane : next.findIndex((l) => l?.hash === parent)
      lines.push({ x1: lane, y1: 0.5, x2: target, y2: 1, colour: next[target]!.colour })
    }

    while (next.length > 0 && next.at(-1) === null) next.pop()
    width = Math.max(width, lanes.length, next.length)
    rows.push({ lane, colour, lines })
    lanes = next
  }
  return { rows, width }
}

function firstFree(lanes: Lane[]): number {
  const index = lanes.indexOf(null)
  return index === -1 ? lanes.length : index
}
