/**
 * Turning `git diff -U0` into per-line marks for the editor gutter.
 *
 * `-U0` asks for no context lines, so the output is just hunk headers and the
 * changed lines themselves — the headers alone carry everything a gutter needs,
 * which keeps this a string parse rather than a diff implementation.
 */

export type ChangeKind = 'added' | 'modified' | 'removed'

export interface LineChange {
  /** 1-based line number in the working copy. */
  line: number
  kind: ChangeKind
}

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseDiffHunks(diff: string): LineChange[] {
  const out: LineChange[] = []
  for (const raw of diff.split('\n')) {
    const m = HUNK.exec(raw)
    if (!m) continue
    // A count is omitted when it is exactly 1.
    const oldCount = m[2] === undefined ? 1 : Number(m[2])
    const newStart = Number(m[3])
    const newCount = m[4] === undefined ? 1 : Number(m[4])

    if (newCount === 0) {
      // Nothing left in the working copy to mark, so the wedge goes on the line
      // the removed text used to follow. `+0,0` means it was removed from the
      // very top, where there is no preceding line.
      out.push({ line: Math.max(1, newStart), kind: 'removed' })
      continue
    }
    // Git merges adjacent edits into one hunk, so a hunk that replaces one line
    // with three is a single `-2,1 +2,3`. Reporting all three as modified would
    // be true but useless: the first line replaced something, the other two are
    // new. Only the overlap is a modification; the surplus is an addition.
    for (let i = 0; i < newCount; i++) {
      out.push({ line: newStart + i, kind: i < oldCount ? 'modified' : 'added' })
    }
  }
  return out
}
