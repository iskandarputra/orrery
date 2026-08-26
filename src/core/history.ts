export interface Snapshot {
  /** Sortable identity — the timestamp it was taken at. */
  id: string
  at: number
  bytes: number
}

/** A change this large is kept whatever the timing. */
const BIG_CHANGE_RATIO = 0.25
/** …but never fewer characters than this, or every keystroke counts as big. */
const BIG_CHANGE_MIN_CHARS = 200
/** Saves closer together than this share one version. */
const MIN_GAP_MS = 2 * 60_000

export interface SnapshotDecision {
  last: { content: string; at: number } | null
  next: string
  now: number
}

/**
 * Whether this save deserves its own version.
 *
 * Autosave fires every couple of seconds, so keeping every save would bury the
 * history in near-identical entries. Saves inside a short window therefore
 * share a version — unless the change is large, because losing a rewrite
 * because it happened a minute after the last one is the exact case history
 * exists for.
 */
export function shouldSnapshot({ last, next, now }: SnapshotDecision): boolean {
  if (!last) return true
  if (last.content === next) return false
  if (now - last.at >= MIN_GAP_MS) return true

  const changed = Math.abs(next.length - last.content.length)
  return changed >= Math.max(BIG_CHANGE_MIN_CHARS, last.content.length * BIG_CHANGE_RATIO)
}

export interface PrunePolicy {
  /** How many versions to keep per note. */
  keep: number
  maxAgeMs: number
  now: number
}

/** The snapshots to delete: too many, or too old — but never the last one. */
export function prune(snapshots: readonly Snapshot[], policy: PrunePolicy): Snapshot[] {
  if (snapshots.length === 0) return []
  const newestFirst = [...snapshots].sort((a, b) => b.at - a.at)
  return newestFirst.filter((snapshot, index) => {
    if (index === 0) return false // a note's latest version always survives
    return index >= policy.keep || policy.now - snapshot.at > policy.maxAgeMs
  })
}
