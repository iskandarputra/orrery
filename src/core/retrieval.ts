import type { LinkGraph } from '@shared/types'

/** How much a note being linked from a top hit is worth, in similarity points. */
const DEFAULT_NEIGHBOUR_BONUS = 0.06
/**
 * Hits whose notes define the neighbourhood. Proportional to k rather than
 * fixed: a fixed seed count makes every candidate a seed on a small vault,
 * and expansion then has nothing left to add.
 */
const seedCount = (k: number): number => Math.max(2, Math.ceil(k / 2))
/** Chunks any one note may contribute, so a long note can't crowd out the rest. */
const DEFAULT_PER_NOTE = 2

export interface ScoredChunk {
  path: string
  line: number
  text: string
  /** Similarity to the query, 0–1. */
  score: number
}

export interface SelectContextParams {
  chunks: ScoredChunk[]
  graph: LinkGraph
  /** How many chunks to hand the model. */
  k: number
  /** How many top hits define the neighbourhood; defaults to about half of k. */
  seeds?: number
  perNote?: number
  neighbourBonus?: number
}

/**
 * Choose the passages to answer from, using the link graph as well as the text.
 *
 * Pure vector search judges each chunk alone, so a note that *explains* the best
 * hit — and is linked from it — loses to an unrelated note that happens to share
 * vocabulary. Notes adjacent to the strongest hits get a small bonus: enough to
 * win a close call, never enough to beat a much better textual match. A per-note
 * cap stops one long note filling the whole context window.
 */
export function selectContext(params: SelectContextParams): ScoredChunk[] {
  const {
    chunks,
    graph,
    k,
    seeds = seedCount(k),
    perNote = DEFAULT_PER_NOTE,
    neighbourBonus = DEFAULT_NEIGHBOUR_BONUS
  } = params
  if (chunks.length === 0 || k <= 0) return []

  const ranked = [...chunks].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const seedNotes = new Set(ranked.slice(0, seeds).map((c) => c.path))

  const neighbours = new Set<string>()
  for (const edge of graph.edges) {
    if (seedNotes.has(edge.from)) neighbours.add(edge.to)
    if (seedNotes.has(edge.to)) neighbours.add(edge.from)
  }

  const boosted = ranked.map((chunk) => ({
    chunk,
    rank: chunk.score + (neighbours.has(chunk.path) && !seedNotes.has(chunk.path) ? neighbourBonus : 0)
  }))
  boosted.sort((a, b) => b.rank - a.rank || a.chunk.path.localeCompare(b.chunk.path))

  const picked: ScoredChunk[] = []
  const takenPerNote = new Map<string, number>()
  const seenLines = new Set<string>()
  for (const { chunk } of boosted) {
    const key = `${chunk.path}:${chunk.line}`
    if (seenLines.has(key)) continue
    const taken = takenPerNote.get(chunk.path) ?? 0
    if (taken >= perNote) continue
    seenLines.add(key)
    takenPerNote.set(chunk.path, taken + 1)
    picked.push(chunk)
    if (picked.length >= k) break
  }
  return picked
}
