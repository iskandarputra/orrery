import { alignHunk, type DiffHunk, type DiffRow, type FileDiff } from './unified-diff'

/**
 * Aligning two whole files, not just the hunks between them.
 *
 * A hunk describes a changed region and nothing else, which is enough to *list*
 * changes but not to show two files side by side: the unchanged stretches
 * between hunks have to be there too, or the panes drift apart the moment the
 * reader scrolls past the first change.
 *
 * The output is a padding plan. Where one side has a line the other does not,
 * that side gets blank space of the same height, so line 400 of the old file
 * stays opposite line 412 of the new one all the way down.
 */

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Where a hunk begins in each file.
 *
 * Not simply the header's numbers. For a side with no lines — a pure insertion
 * writes `-3,0` — git reports the line the hunk comes *after*, not the line it
 * starts at. Taken literally that stops the preceding run of unchanged lines one
 * line short, and everything below the first insertion is drawn one line out.
 * A count of zero therefore advances the start by one.
 */
export function hunkStart(hunk: DiffHunk): { old: number; new: number } {
  const m = hunk.header.match(HEADER)
  // A hunk without a parseable header cannot be placed; treating it as line 1
  // would silently misalign the file, so it is skipped by the caller instead.
  if (!m) return { old: 0, new: 0 }
  // An omitted count means one line, which is git's shorthand, not zero.
  const oldCount = m[2] === undefined ? 1 : Number(m[2])
  const newCount = m[4] === undefined ? 1 : Number(m[4])
  return {
    old: Number(m[1]) + (oldCount === 0 ? 1 : 0),
    new: Number(m[3]) + (newCount === 0 ? 1 : 0)
  }
}

/**
 * Every line of both files, paired.
 *
 * `oldCount`/`newCount` are the files' real line counts: the tail after the
 * last hunk is unchanged and therefore absent from the diff, but it still has
 * to be rendered.
 */
export function alignFile(diff: FileDiff, oldCount: number, newCount: number): DiffRow[] {
  const rows: DiffRow[] = []
  // Next line of each file not yet emitted, 1-based.
  let oldAt = 1
  let newAt = 1

  const context = (count: number): void => {
    for (let i = 0; i < count; i++) {
      rows.push({
        left: { kind: 'context', text: '', oldLine: oldAt, newLine: newAt },
        right: { kind: 'context', text: '', oldLine: oldAt, newLine: newAt }
      })
      oldAt++
      newAt++
    }
  }

  for (const hunk of diff.hunks) {
    const start = hunkStart(hunk)
    if (start.old === 0) continue
    context(Math.max(0, start.old - oldAt))
    for (const row of alignHunk(hunk)) {
      rows.push(row)
      if (row.left) oldAt++
      if (row.right) newAt++
    }
  }

  // The unchanged tail. Both sides advance together, so one count is enough —
  // but the smaller is taken, because a truncated diff can leave them unequal
  // and running past the end of a file would invent lines.
  context(Math.max(0, Math.min(oldCount - oldAt, newCount - newAt) + 1))
  return rows
}

/**
 * How much blank space each side needs, and where.
 *
 * Keyed by the 1-based line the padding goes *above*. A gap at the very end of a
 * file is keyed one past its last line, which is the only key that does not name
 * a line that exists.
 */
export interface Padding {
  left: Map<number, number>
  right: Map<number, number>
}

export function padding(rows: DiffRow[], oldCount: number, newCount: number): Padding {
  const left = new Map<number, number>()
  const right = new Map<number, number>()
  // Gaps seen so far on each side, waiting for the next real line to hang from.
  let leftGap = 0
  let rightGap = 0
  let lastLeft = 0
  let lastRight = 0

  const add = (map: Map<number, number>, line: number, count: number): void => {
    if (count > 0) map.set(line, (map.get(line) ?? 0) + count)
  }

  for (const row of rows) {
    if (row.left?.oldLine != null) {
      add(left, row.left.oldLine, leftGap)
      leftGap = 0
      lastLeft = row.left.oldLine
    } else if (row.right) {
      // A line the new file has and the old one does not.
      leftGap++
    }

    if (row.right?.newLine != null) {
      add(right, row.right.newLine, rightGap)
      rightGap = 0
      lastRight = row.right.newLine
    } else if (row.left) {
      rightGap++
    }
  }

  // Trailing gaps have no following line to hang from, so they go one past the
  // end. `lastLeft` is used rather than the count because a diff can stop short
  // of the file's real end.
  add(left, Math.max(lastLeft, oldCount) + 1, leftGap)
  add(right, Math.max(lastRight, newCount) + 1, rightGap)
  return { left, right }
}

/** The lines each side should mark, read straight off the aligned rows. */
export function changedLines(rows: DiffRow[]): { removed: number[]; added: number[] } {
  const removed: number[] = []
  const added: number[] = []
  for (const row of rows) {
    if (row.left?.kind === 'removed' && row.left.oldLine != null) removed.push(row.left.oldLine)
    if (row.right?.kind === 'added' && row.right.newLine != null) added.push(row.right.newLine)
  }
  return { removed, added }
}
