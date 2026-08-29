/**
 * Parsing a unified diff into something renderable.
 *
 * `git-diff.ts` reads hunk *headers* only, which is all a gutter needs. A diff
 * view needs the lines themselves, each tagged with where it sits in the old
 * file, the new file, or both.
 *
 * Kept free of processes so the parsing can be tested against captured output.
 */

export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 1-based line in the old file; null for an addition. */
  oldLine: number | null
  /** 1-based line in the new file; null for a removal. */
  newLine: number | null
}

export interface DiffHunk {
  /** The `@@ … @@` line verbatim, including any trailing section heading. */
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  hunks: DiffHunk[]
  /** Git reported the file as binary; there is nothing to show line by line. */
  binary: boolean
  added: number
  removed: number
}

export const EMPTY_DIFF: FileDiff = { hunks: [], binary: false, added: 0, removed: 0 }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnifiedDiff(diff: string): FileDiff {
  const result: FileDiff = { hunks: [], binary: false, added: 0, removed: 0 }
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
      result.binary = true
      return result
    }

    const match = HUNK.exec(raw)
    if (match) {
      oldLine = Number(match[1])
      newLine = Number(match[2])
      hunk = { header: raw, lines: [] }
      result.hunks.push(hunk)
      continue
    }

    // Everything before the first @@ is file header noise: `diff --git`,
    // `index`, `---`, `+++`, `similarity index`, mode changes.
    if (!hunk) continue

    // "\ No newline at end of file" annotates the line before it and occupies
    // no position in either file.
    if (raw.startsWith('\\')) continue

    const marker = raw[0]
    const text = raw.slice(1)

    if (marker === '+') {
      hunk.lines.push({ kind: 'added', text, oldLine: null, newLine })
      newLine++
      result.added++
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'removed', text, oldLine, newLine: null })
      oldLine++
      result.removed++
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'context', text, oldLine, newLine })
      oldLine++
      newLine++
    }
    // Any other leading character is not part of a hunk body; git does not
    // emit one, and inventing a line for it would shift every number after it.
  }

  return result
}

/**
 * One row of a side-by-side view: the old line, the new line, or both.
 *
 * A context line occupies both columns. A run of removals followed by a run of
 * additions is paired off index by index — that is what makes a replaced line
 * sit opposite the line it replaced — and whichever run is shorter leaves empty
 * cells at the end rather than shifting everything below it out of alignment.
 */
export interface DiffRow {
  left: DiffLine | null
  right: DiffLine | null
}

export function alignHunk(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0

  while (i < hunk.lines.length) {
    const line = hunk.lines[i]!

    if (line.kind === 'context') {
      rows.push({ left: line, right: line })
      i++
      continue
    }

    // Collect the removals, then the additions that immediately follow them.
    const removed: DiffLine[] = []
    while (hunk.lines[i]?.kind === 'removed') removed.push(hunk.lines[i++]!)
    const added: DiffLine[] = []
    while (hunk.lines[i]?.kind === 'added') added.push(hunk.lines[i++]!)

    for (let n = 0; n < Math.max(removed.length, added.length); n++) {
      rows.push({ left: removed[n] ?? null, right: added[n] ?? null })
    }
  }

  return rows
}
