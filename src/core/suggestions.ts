import type { LinkGraph } from '@shared/types'
import { cosineSimilarity } from './vector'

/** Below this, two notes aren't about the same thing. */
const DEFAULT_MIN_SIMILARITY = 0.72
const DEFAULT_LIMIT = 5
/** Hops past this count as "the other side of the vault". */
const FAR = 5

export interface LinkSuggestion {
  id: string
  label: string
  /** Cosine similarity of the two notes' centroids, 0–1. */
  similarity: number
  /** Shortest existing path between them, or null if they're on separate islands. */
  hops: number | null
}

export interface SuggestLinksParams {
  /** Path of the note being looked at. */
  from: string
  /** Note path → centroid vector, from the embedding index. */
  vectors: Map<string, number[]>
  graph: LinkGraph
  limit?: number
  minSimilarity?: number
}

/** A note's position in embedding space: the unit mean of its chunk vectors. */
export function noteCentroid(chunks: readonly number[][]): number[] {
  if (chunks.length === 0) return []
  const width = chunks[0]!.length
  const sum = new Array<number>(width).fill(0)
  for (const chunk of chunks) {
    for (let i = 0; i < width; i++) sum[i] = sum[i]! + (chunk[i] ?? 0)
  }
  const magnitude = Math.hypot(...sum)
  return magnitude === 0 ? sum : sum.map((value) => value / magnitude)
}

/**
 * Links the vault is missing: notes about the same thing that aren't connected.
 *
 * Semantic similarity alone just lists neighbours — the useful signal is
 * similarity *plus* structural distance, because a close note five hops away
 * (or on another island) is a real gap, while a close note you already reach in
 * two is mostly noise. Directly linked notes are excluded outright: there is
 * nothing left to suggest.
 */
export function suggestLinks(params: SuggestLinksParams): LinkSuggestion[] {
  const { from, vectors, graph, limit = DEFAULT_LIMIT, minSimilarity = DEFAULT_MIN_SIMILARITY } =
    params
  const source = vectors.get(from)
  if (!source?.length) return [] // not indexed yet — nothing to compare

  const hops = shortestHops(graph, from)

  const scored = []
  // Driven by the graph, not the index: a deleted note can linger in the
  // vectors until the next reindex, and ghosts have no text to compare.
  for (const note of graph.nodes) {
    const id = note.id
    const vector = vectors.get(id)
    if (id === from || !note.exists || !vector?.length) continue
    const distance = hops.get(id) ?? null
    if (distance === 1) continue // already linked, either direction
    const similarity = cosineSimilarity(source, vector)
    if (similarity < minSimilarity) continue
    scored.push({
      id,
      label: note.label,
      similarity,
      hops: distance,
      // Distance breaks ties toward the genuine gaps; an island counts as far.
      rank: similarity * (1 + 0.05 * Math.min(distance ?? FAR, FAR))
    })
  }

  return scored
    .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ id, label, similarity, hops: distance }) => ({
      id,
      label,
      similarity,
      hops: distance
    }))
}

/** BFS over the undirected link graph: note → hops away from `from`. */
function shortestHops(graph: LinkGraph, from: string): Map<string, number> {
  const neighbors = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    const list = neighbors.get(a)
    if (list) list.push(b)
    else neighbors.set(a, [b])
  }
  for (const edge of graph.edges) {
    link(edge.from, edge.to)
    link(edge.to, edge.from)
  }

  const distance = new Map<string, number>([[from, 0]])
  const queue = [from]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    for (const next of neighbors.get(current) ?? []) {
      if (distance.has(next)) continue
      distance.set(next, distance.get(current)! + 1)
      queue.push(next)
    }
  }
  return distance
}
