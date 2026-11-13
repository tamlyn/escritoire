import { expect, test } from 'vitest'
import { layoutGraph } from './graph'

const commit = (hash: string, ...parents: string[]) => ({ hash, parents })

test('keeps a straight history in one lane', () => {
  const graph = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')])
  expect(graph.width).toBe(1)
  expect(graph.rows.map((r) => r.lane)).toEqual([0, 0, 0])
  // Nothing leads into the tip from above.
  expect(graph.rows[0]!.lines).toEqual([{ x1: 0, y1: 0.5, x2: 0, y2: 1, colour: 0 }])
  expect(graph.rows[1]!.lines).toEqual([
    { x1: 0, y1: 0, x2: 0, y2: 0.5, colour: 0 },
    { x1: 0, y1: 0.5, x2: 0, y2: 1, colour: 0 },
  ])
  // The root commit has nothing below it.
  expect(graph.rows[2]!.lines).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 0.5, colour: 0 }])
})

test('opens a lane for a merged branch and closes it at the fork', () => {
  // merge ← main ← base, merge ← feature ← base
  const graph = layoutGraph([commit('merge', 'main', 'feature'), commit('feature', 'base'), commit('main', 'base'), commit('base')])
  expect(graph.width).toBe(2)
  expect(graph.rows.map((r) => r.lane)).toEqual([0, 1, 0, 0])
  const [merge, feature, main, base] = graph.rows
  expect(merge!.lines).toContainEqual({ x1: 0, y1: 0.5, x2: 1, y2: 1, colour: 1 })
  expect(feature!.colour).toBe(1)
  // main passes feature's row straight down.
  expect(feature!.lines).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 1, colour: 0 })
  // feature's lane waits for base alongside main's.
  expect(main!.lines).toContainEqual({ x1: 1, y1: 0, x2: 1, y2: 1, colour: 1 })
  // Both lanes join at base.
  expect(base!.lines).toEqual([
    { x1: 0, y1: 0, x2: 0, y2: 0.5, colour: 0 },
    { x1: 1, y1: 0, x2: 0, y2: 0.5, colour: 1 },
  ])
})

test('starts a branch tip in the first free lane', () => {
  const graph = layoutGraph([commit('a', 'base'), commit('b', 'base'), commit('base')])
  expect(graph.rows.map((r) => r.lane)).toEqual([0, 1, 0])
  expect(graph.rows[1]!.lines).toEqual([
    { x1: 0, y1: 0, x2: 0, y2: 1, colour: 0 },
    { x1: 1, y1: 0.5, x2: 1, y2: 1, colour: 1 },
  ])
})
