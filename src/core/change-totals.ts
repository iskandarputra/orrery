import type { DiffStats } from './git-numstat'
import { stagedChanges, unstagedChanges, type GitStatus } from './git-status'

/**
 * How much the working tree has changed, all told: the number beside the
 * source control icon, and the totals on the Changes header.
 */
export interface ChangeTotals {
  /** Files with any change, each counted once. */
  files: number
  /** Lines added across every row the panel lists. */
  insertions: number
  /** Lines removed across every row the panel lists. */
  deletions: number
}

/**
 * Files with any change, each counted once.
 *
 * A file staged and then edited again is listed twice, once under Staged and
 * once under Unstaged, and a count of rows would call that two changed files.
 * It is one file, and "how many files have I touched" is the question the
 * badge answers. Status already reports each path once, with both sides on it.
 */
export function changedFileCount(status: GitStatus): number {
  return status.changes.length
}

/**
 * The files, and the sum of the line counts on every row.
 *
 * Summed by row rather than by file, so the totals are exactly what adding up
 * the column beside the names would give. A file on both sides contributes
 * its staged lines and its unstaged lines, which are different edits. A row
 * whose count has not arrived, or a binary file, adds nothing: a total that
 * guessed would be a number nobody could check against the list.
 */
export function changeTotals(status: GitStatus, stats: DiffStats): ChangeTotals {
  let insertions = 0
  let deletions = 0
  const add = (stat: DiffStats['staged'][string] | undefined): void => {
    if (!stat || stat.binary) return
    insertions += stat.insertions
    deletions += stat.deletions
  }
  for (const change of stagedChanges(status)) add(stats.staged[change.path])
  for (const change of unstagedChanges(status)) add(stats.unstaged[change.path])
  return { files: changedFileCount(status), insertions, deletions }
}
