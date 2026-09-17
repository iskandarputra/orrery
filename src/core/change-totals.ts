import type { DiffStatsByPath } from './git-numstat'
import type { GitChange, GitStatus } from './git-status'

/**
 * How much the working tree has changed: the number beside the source control
 * icon, and the totals on each section's header.
 */
export interface ChangeTotals {
  /** Files, each counted once. */
  files: number
  /** Lines added across the rows counted. */
  insertions: number
  /** Lines removed across the rows counted. */
  deletions: number
}

/**
 * Files with any change, each counted once.
 *
 * A file staged and then edited again is listed twice, once under Staged
 * Changes and once under Changes, and a count of rows would call that two
 * changed files.
 * It is one file, and "how many files have I touched" is the question the
 * badge answers. Status already reports each path once, with both sides on it.
 */
export function changedFileCount(status: GitStatus): number {
  return status.changes.length
}

/**
 * One section's files and the sum of the line counts on its rows: Staged
 * Changes with the staged counts, Changes with the unstaged ones.
 *
 * Summed by row, so the totals are exactly what adding up the column beside
 * the names in that section gives. A row whose count has not arrived, or a
 * binary file, adds nothing: a total that guessed would be a number nobody
 * could check against the list.
 */
export function sectionTotals(changes: readonly GitChange[], stats: DiffStatsByPath): ChangeTotals {
  let insertions = 0
  let deletions = 0
  for (const change of changes) {
    const stat = stats[change.path]
    if (!stat || stat.binary) continue
    insertions += stat.insertions
    deletions += stat.deletions
  }
  return { files: changes.length, insertions, deletions }
}
