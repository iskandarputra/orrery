import type {
  AnalyzedGraphNode,
  BrokenLink,
  GraphAnalysis,
  GraphInsights,
  LinkGraph,
  RankedNote,
  VaultStats
} from '@shared/types'

const DAMPING = 0.85
const PAGERANK_ITERATIONS = 30
const PAGERANK_EPSILON = 1e-8
/** Above this many nodes, betweenness is estimated from pivots instead of every source. */
const EXACT_BETWEENNESS_MAX = 500
const BETWEENNESS_PIVOTS = 200
const LABEL_PROPAGATION_ITERATIONS = 20
const DAY_MS = 24 * 60 * 60 * 1000

export interface AnalyzeOptions {
  /** Clock for the "modified recently" buckets. Injected so tests don't drift. */
  now?: number
  /** How many entries each ranked list keeps. */
  top?: number
}

/**
 * Structural analysis of the vault's link graph: influence, bridges, clusters
 * and the rosters that turn them into something to act on.
 *
 * Pure and deterministic — no clock, no randomness, no IO. Pivot choice and
 * every tie-break go by node order, so the same vault always yields the same
 * numbers (stable colours in the graph, no flicker, no flaky tests). Runs in
 * the main process during the vault scan, and again in the renderer over a
 * filtered sub-graph.
 */
export function analyzeGraph(graph: LinkGraph, options: AnalyzeOptions = {}): GraphAnalysis {
  const { now = 0, top = 10 } = options
  const nodes = graph.nodes
  const size = nodes.length
  const index = new Map<string, number>()
  nodes.forEach((node, i) => index.set(node.id, i))

  const out: number[][] = Array.from({ length: size }, () => [])
  const into: number[][] = Array.from({ length: size }, () => [])
  const neighbors: number[][] = Array.from({ length: size }, () => [])
  const edges = graph.edges.filter((e) => index.has(e.from) && index.has(e.to))
  for (const edge of edges) {
    const from = index.get(edge.from)!
    const to = index.get(edge.to)!
    out[from]!.push(to)
    into[to]!.push(from)
    neighbors[from]!.push(to)
    neighbors[to]!.push(from)
  }

  const pagerank = computePagerank(out, size)
  const betweenness = computeBetweenness(neighbors, size)
  const component = computeComponents(neighbors, size)
  const community = computeCommunities(neighbors, size)

  const analyzed: AnalyzedGraphNode[] = nodes.map((node, i) => ({
    ...node,
    inDegree: into[i]!.length,
    outDegree: out[i]!.length,
    pagerank: pagerank[i]!,
    betweenness: betweenness[i]!,
    component: component[i]!,
    community: community[i]!
  }))

  return {
    nodes: analyzed,
    edges: graph.edges,
    stats: computeStats(analyzed, component, now),
    insights: computeInsights(analyzed, into, top)
  }
}

/**
 * Influence, by the random-surfer model: a link from a well-linked note counts
 * for more than one from a stub. Mass held by notes that link nowhere is spread
 * evenly rather than lost, so the scores always total 1.
 */
function computePagerank(out: number[][], size: number): number[] {
  if (size === 0) return []
  let rank = new Array<number>(size).fill(1 / size)

  for (let iteration = 0; iteration < PAGERANK_ITERATIONS; iteration++) {
    const incoming = new Array<number>(size).fill(0)
    let dangling = 0
    for (let i = 0; i < size; i++) {
      const targets = out[i]!
      if (targets.length === 0) {
        dangling += rank[i]!
        continue
      }
      const share = rank[i]! / targets.length
      for (const target of targets) incoming[target] = incoming[target]! + share
    }

    const base = (1 - DAMPING) / size + (DAMPING * dangling) / size
    let delta = 0
    const next = new Array<number>(size)
    for (let i = 0; i < size; i++) {
      next[i] = base + DAMPING * incoming[i]!
      delta += Math.abs(next[i]! - rank[i]!)
    }
    rank = next
    if (delta < PAGERANK_EPSILON) break
  }
  return rank
}

/**
 * Brandes' algorithm over the undirected view: how often each note sits on the
 * shortest path between two others — the notes that hold the vault together.
 * Every source is used up to `EXACT_BETWEENNESS_MAX` nodes; past that, evenly
 * spaced pivots estimate it and the result is scaled back up.
 */
function computeBetweenness(neighbors: number[][], size: number): number[] {
  const score = new Array<number>(size).fill(0)
  if (size < 3) return score

  const exact = size <= EXACT_BETWEENNESS_MAX
  const step = exact ? 1 : Math.ceil(size / BETWEENNESS_PIVOTS)
  const sources: number[] = []
  for (let s = 0; s < size; s += step) sources.push(s)

  const sigma = new Array<number>(size)
  const distance = new Array<number>(size)
  const delta = new Array<number>(size)
  const predecessors: number[][] = Array.from({ length: size }, () => [])

  for (const source of sources) {
    for (let i = 0; i < size; i++) {
      sigma[i] = 0
      distance[i] = -1
      delta[i] = 0
      predecessors[i]!.length = 0
    }
    sigma[source] = 1
    distance[source] = 0

    const order: number[] = []
    const queue = [source]
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]!
      order.push(v)
      for (const w of neighbors[v]!) {
        if (distance[w] === -1) {
          distance[w] = distance[v]! + 1
          queue.push(w)
        }
        if (distance[w] === distance[v]! + 1) {
          sigma[w] = sigma[w]! + sigma[v]!
          predecessors[w]!.push(v)
        }
      }
    }

    for (let i = order.length - 1; i > 0; i--) {
      const w = order[i]!
      for (const v of predecessors[w]!) {
        delta[v] = delta[v]! + (sigma[v]! / sigma[w]!) * (1 + delta[w]!)
      }
      score[w] = score[w]! + delta[w]!
    }
  }

  // Each unordered pair is counted from both ends; then scale a sampled run
  // back to full size and normalise to 0–1 against the theoretical maximum.
  const sampleScale = size / sources.length
  const pairs = ((size - 1) * (size - 2)) / 2
  for (let i = 0; i < size; i++) score[i] = ((score[i]! / 2) * sampleScale) / pairs
  return score
}

/** Disconnected islands, ignoring link direction. */
function computeComponents(neighbors: number[][], size: number): number[] {
  const component = new Array<number>(size).fill(-1)
  let next = 0
  for (let start = 0; start < size; start++) {
    if (component[start] !== -1) continue
    const queue = [start]
    component[start] = next
    for (let head = 0; head < queue.length; head++) {
      for (const w of neighbors[queue[head]!]!) {
        if (component[w] === -1) {
          component[w] = next
          queue.push(w)
        }
      }
    }
    next++
  }
  return component
}

/**
 * Topic clusters by label propagation: each note repeatedly adopts the label
 * most common among its neighbours. Nodes are visited in order and ties break
 * toward the lower label, which makes the outcome reproducible — unlike the
 * usual randomised formulation, whose clusters (and therefore colours) would
 * shuffle on every rebuild.
 */
function computeCommunities(neighbors: number[][], size: number): number[] {
  const label = new Array<number>(size)
  for (let i = 0; i < size; i++) label[i] = i

  for (let iteration = 0; iteration < LABEL_PROPAGATION_ITERATIONS; iteration++) {
    let changed = false
    for (let i = 0; i < size; i++) {
      const adjacent = neighbors[i]!
      if (adjacent.length === 0) continue
      const counts = new Map<number, number>()
      for (const w of adjacent) counts.set(label[w]!, (counts.get(label[w]!) ?? 0) + 1)
      let best = label[i]!
      let bestCount = 0
      for (const [candidate, count] of counts) {
        if (count > bestCount || (count === bestCount && candidate < best)) {
          best = candidate
          bestCount = count
        }
      }
      if (best !== label[i]) {
        label[i] = best
        changed = true
      }
    }
    if (!changed) break
  }

  // Compact to 0..n so the UI can index a palette directly.
  const compact = new Map<number, number>()
  return label.map((value) => {
    let id = compact.get(value)
    if (id === undefined) {
      id = compact.size
      compact.set(value, id)
    }
    return id
  })
}

function computeStats(nodes: AnalyzedGraphNode[], component: number[], now: number): VaultStats {
  const real = nodes.filter((n) => n.exists)
  const links = nodes.reduce((sum, n) => sum + n.outDegree, 0)

  const outDegrees = real.map((n) => n.outDegree).sort((a, b) => a - b)
  const middle = Math.floor(outDegrees.length / 2)
  const medianOutDegree =
    outDegrees.length === 0
      ? 0
      : outDegrees.length % 2 === 1
        ? outDegrees[middle]!
        : (outDegrees[middle - 1]! + outDegrees[middle]!) / 2

  const histogram: number[] = []
  for (const node of real) {
    histogram[node.outDegree] = (histogram[node.outDegree] ?? 0) + 1
  }
  for (let i = 0; i < histogram.length; i++) histogram[i] ??= 0

  const sizes = new Map<number, number>()
  for (const id of component) sizes.set(id, (sizes.get(id) ?? 0) + 1)
  const largest = sizes.size === 0 ? 0 : Math.max(...sizes.values())

  const within = (days: number): number =>
    real.filter((n) => n.mtimeMs > 0 && now - n.mtimeMs <= days * DAY_MS).length

  return {
    notes: real.length,
    ghosts: nodes.length - real.length,
    links,
    words: real.reduce((sum, n) => sum + n.words, 0),
    avgOutDegree: real.length === 0 ? 0 : links / real.length,
    medianOutDegree,
    components: sizes.size,
    largestComponentShare: nodes.length === 0 ? 0 : largest / nodes.length,
    linkHistogram: histogram,
    modified: { last7: within(7), last30: within(30), last90: within(90) }
  }
}

/** Score desc, then id — so equal scores don't reshuffle between runs. */
function rank(candidates: RankedNote[], top: number): RankedNote[] {
  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, top)
}

function computeInsights(nodes: AnalyzedGraphNode[], into: number[][], top: number): GraphInsights {
  const orphans: RankedNote[] = []
  const deadEnds: RankedNote[] = []
  const brokenLinks: BrokenLink[] = []
  const hubs: RankedNote[] = []
  const connectors: RankedNote[] = []

  nodes.forEach((node, i) => {
    if (!node.exists) {
      // Neither kind is an orphan: there is no file to fix up, only a link.
      // Told apart by the id prefix rather than by `kind`. Inside this branch
      // `kind` would work today, since a ghost is built 'note' and a missing
      // import 'code', but that is how the two happen to be constructed and
      // not a guarantee: a ghost for `[[script.ts]]` could reasonably be made
      // to look like code, and a `kind` test would mislabel from then on
      // without failing. The prefix is the node's own identity.
      brokenLinks.push({
        id: node.id,
        label: node.label,
        kind: node.id.startsWith('missing:') ? 'import' : 'note',
        from: into[i]!.map((j) => nodes[j]!.id).sort()
      })
      return
    }
    if (node.inDegree === 0 && node.outDegree === 0) {
      orphans.push({ id: node.id, label: node.label, score: node.words, exists: node.exists })
    } else if (node.outDegree === 0) {
      deadEnds.push({ id: node.id, label: node.label, score: node.inDegree, exists: node.exists })
    }
    if (node.pagerank > 0) {
      hubs.push({ id: node.id, label: node.label, score: node.pagerank, exists: node.exists })
    }
    if (node.betweenness > 0) {
      connectors.push({
        id: node.id,
        label: node.label,
        score: node.betweenness,
        exists: node.exists
      })
    }
  })

  return {
    orphans: rank(orphans, top),
    deadEnds: rank(deadEnds, top),
    brokenLinks: brokenLinks
      .sort((a, b) => b.from.length - a.from.length || a.id.localeCompare(b.id))
      .slice(0, top),
    hubs: rank(hubs, top),
    connectors: rank(connectors, top)
  }
}
