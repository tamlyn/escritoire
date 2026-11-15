import { byLengthAsc, Fzf, type Tiebreaker } from 'fzf'

/** An item that matched, with the indices of the matched characters in its path. */
export type FuzzyMatch<T> = { item: T; positions: Set<number> }

/**
 * fzf's matching over a list of paths, best first. Build it once per list: the
 * list is prepared up front so each query is quick. An empty query returns the
 * list in order.
 */
export function fuzzyFinder<T>(
  items: readonly T[],
  options: { path: (item: T) => string; limit: number },
): (query: string) => FuzzyMatch<T>[] {
  // As unknowns, since fzf's option types depend on whether the items are strings,
  // which TypeScript can't decide for a generic T.
  const fzf = new Fzf<readonly unknown[]>(items, {
    selector: (item) => options.path(item as T),
    limit: options.limit,
    casing: 'smart-case',
    tiebreakers: [byMatchInName, byLengthAsc],
  })
  return (query) => fzf.find(query).map(({ item, positions }) => ({ item: item as T, positions }))
}

/** As fzf's own path scheme: of equal matches, one in the file name beats one in a directory. */
const byMatchInName: Tiebreaker<unknown> = (a, b, selector) => {
  const inName = (result: typeof a) => Number(result.start > selector(result.item).lastIndexOf('/'))
  return inName(b) - inName(a)
}
