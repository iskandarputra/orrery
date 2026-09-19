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

export interface ChangeMark {
  /** A line in the new file, 1-based. */
  line: number
  kind: 'added' | 'removed' | 'replaced'
  /**
   * For `replaced` only: how much of the band stands for the removal, 0 to 1.
   *
   * The count of lines that went over the count that went and came, so a hunk
   * that swapped two for two is half and half, and one that dropped six to
   * write one back is mostly red.
   */
  removedShare?: number
}

/**
 * Where the changes are, in the new file's numbering.
 *
 * The working tree is the side with the minimap, and it has no line for a
 * deleted one — so a removal is marked where it happened: on the line that took
 * its place, or on the last line when the file ends with the deletion.
 *
 * A rewritten line used to count as plain `added`, on the reasoning that it is
 * the line somebody would go and look at. That is true of where to put the
 * cursor and wrong about what to paint: the left pane was showing red, the
 * right pane green, and the strip between them showed green alone, so the
 * commonest edit there is — replacing a line — looked exactly like writing a
 * new one. It is its own kind now, and it carries both colours.
 */
export function changeMarks(rows: DiffRow[]): ChangeMark[] {
  const marks = new Map<number, ChangeMark>()
  /** Removals with no line of their own yet; the next line takes them. */
  let pending = 0
  let lastNew = 0
  let i = 0

  const changed = (row: DiffRow): boolean =>
    row.left?.kind === 'removed' || row.right?.kind === 'added'

  while (i < rows.length) {
    const row = rows[i]!
    if (!changed(row)) {
      const line = row.right?.newLine
      if (line != null) {
        lastNew = line
        if (pending > 0 && !marks.has(line)) marks.set(line, { line, kind: 'removed' })
        pending = 0
      }
      i++
      continue
    }

    // One block: `alignHunk` gathers a run of removals and the additions that
    // follow it into consecutive rows, which is exactly the shape of a
    // replacement. Counting the block rather than the row is what lets the two
    // halves be weighed against each other.
    let removed = 0
    const added: number[] = []
    while (i < rows.length && changed(rows[i]!)) {
      const r = rows[i]!
      if (r.left?.kind === 'removed') removed++
      if (r.right?.kind === 'added' && r.right.newLine != null) added.push(r.right.newLine)
      i++
    }
    if (added.length > 0) lastNew = added[added.length - 1]!

    if (added.length === 0) {
      // Nothing took its place, so it hangs on whatever line comes next.
      pending += removed
    } else if (removed === 0) {
      for (const line of added) marks.set(line, { line, kind: 'added' })
    } else {
      const removedShare = removed / (removed + added.length)
      for (const line of added) marks.set(line, { line, kind: 'replaced', removedShare })
    }
  }
  // Deletions at the end of the file have no following line to hang from.
  if (pending > 0 && lastNew > 0 && !marks.has(lastNew)) {
    marks.set(lastNew, { line: lastNew, kind: 'removed' })
  }

  return [...marks.values()].sort((a, b) => a.line - b.line)
}
