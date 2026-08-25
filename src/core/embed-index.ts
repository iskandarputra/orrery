/** One embedded slice of a note. */
export interface IndexedChunk {
  path: string
  /** 1-based line the chunk starts at. */
  line: number
  text: string
  vector: number[]
}

/** A note's entry in the index, fingerprinted so unchanged files are reused. */
export interface IndexedFile {
  path: string
  hash: string
  chunks: IndexedChunk[]
}

export interface ReindexPlan {
  /** Files whose vectors are still valid. */
  reuse: IndexedFile[]
  /** Files that must be embedded again. */
  embed: { path: string; content: string }[]
  /** Indexed files that have since been deleted. */
  removed: string[]
}

/**
 * cyrb53 — a fast, well-distributed non-cryptographic hash. Change detection
 * only, so speed beats collision-resistance, and keeping it dependency-free
 * lets this module stay in `core` (shared by main and renderer).
 */
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Work out the smallest amount of embedding needed to bring the index up to
 * date: reuse every file whose content hash is unchanged, embed the rest, drop
 * what has been deleted. Pure, so the expensive part (calling the model) stays
 * in the service and the decision of *what* to call it on is unit-tested.
 */
export function planReindex(
  current: { path: string; content: string }[],
  previous: readonly IndexedFile[]
): ReindexPlan {
  const indexed = new Map(previous.map((file) => [file.path, file]))
  const plan: ReindexPlan = { reuse: [], embed: [], removed: [] }

  for (const file of current) {
    const existing = indexed.get(file.path)
    if (existing && existing.hash === contentHash(file.content)) plan.reuse.push(existing)
    else plan.embed.push(file)
    indexed.delete(file.path)
  }

  plan.removed = [...indexed.keys()]
  return plan
}
