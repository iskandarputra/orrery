/**
 * Deciding which of a graph's notes and links to draw.
 *
 * Three filters that compose: hide notes that are only linked to and do not
 * exist, narrow to a neighbourhood around the note you are reading, and drop
 * notes left with no links once the first two have run. The order matters —
 * orphans can only be counted after ghost and local pruning have removed the
 * edges that were keeping them company — and getting it wrong shows a graph
 * that is subtly not the one asked for, which is the kind of wrong nobody
 * notices.
 *
 * Pulled out of the view because it is a graph algorithm, not a rendering
 * concern, and because a BFS written inside a `useCallback` is a BFS nobody
 * tests.
 */

export interface GraphViewNode {
  /** False for a note that is linked to but does not exist — a "ghost". */
  exists: boolean
}

export interface GraphViewEdge {
  from: string
  to: string
}

export interface GraphViewFilter {
  /** Keep notes that are linked to but do not exist. */
  ghosts: boolean
  /** Keep notes with no links left after filtering. */
  orphans: boolean
  /** Narrow to a neighbourhood around `center`. */
  local: boolean
  /** How many hops out from `center`. Ignored unless `local`. */
  depth: number
  /** The note being read, or null if none is open. */
  center: string | null
}

export interface GraphViewResult<E> {
  ids: Set<string>
  edges: E[]
  /**
   * A local view was asked for with nothing to centre it on. Distinct from an
   * empty result: the graph is not empty, there is just nowhere to stand.
   */
  needsCenter: boolean
}

const EMPTY = { ids: new Set<string>(), edges: [], needsCenter: false }

/** Undirected adjacency over the edges whose ends both survive. */
function adjacency<E extends GraphViewEdge>(edges: E[], ids: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    const list = adj.get(a)
    if (list) list.push(b)
    else adj.set(a, [b])
  }
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue
    link(edge.from, edge.to)
    link(edge.to, edge.from)
  }
  return adj
}

/** Everything within `depth` hops of `center`, following links either way. */
function neighbourhood(adj: Map<string, string[]>, center: string, depth: number): Set<string> {
  const reached = new Set([center])
  let frontier = [center]
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of adj.get(id) ?? []) {
        if (reached.has(neighbour)) continue
        reached.add(neighbour)
        next.push(neighbour)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return reached
}

export function filterGraphView<N extends GraphViewNode, E extends GraphViewEdge>(
  nodes: ReadonlyMap<string, N>,
  allEdges: readonly E[],
  filter: GraphViewFilter
): GraphViewResult<E> {
  if (nodes.size === 0) return { ...EMPTY, ids: new Set() }

  let ids = new Set<string>()
  for (const [id, node] of nodes) if (filter.ghosts || node.exists) ids.add(id)

  if (filter.local) {
    const center = filter.center && ids.has(filter.center) ? filter.center : null
    if (!center) return { ids: new Set(), edges: [], needsCenter: true }
    const reached = neighbourhood(adjacency([...allEdges], ids), center, filter.depth)
    ids = new Set([...ids].filter((id) => reached.has(id)))
  }

  let edges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to))

  // Only now: a note is an orphan when nothing it is still connected to
  // survived the filters above, not when it started out unlinked.
  if (!filter.orphans) {
    const linked = new Set<string>()
    for (const edge of edges) {
      linked.add(edge.from)
      linked.add(edge.to)
    }
    ids = new Set([...ids].filter((id) => linked.has(id)))
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  }

  return { ids, edges, needsCenter: false }
}

/**
 * Rank values by how often they occur, ties broken by name.
 *
 * Used to give the largest clusters the distinct colours and let the tail fall
 * into one muted slot. Ties are broken deterministically so that two clusters of
 * equal size do not swap colours between renders.
 */
export function rankByFrequency(values: readonly (string | number)[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = String(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Map(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key], index) => [key, index])
  )
}
