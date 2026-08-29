import { describe, expect, it } from 'vitest'
import { alignFile, changedLines, hunkStart, padding } from './diff-align'
import { parseUnifiedDiff } from './unified-diff'

/** A real `git diff` body, so the parser is exercised rather than bypassed. */
const diffOf = (body: string): ReturnType<typeof parseUnifiedDiff> => parseUnifiedDiff(body)

describe('hunkStart', () => {
  it('reads both starting lines from the header', () => {
    const d = diffOf('@@ -12,3 +40,4 @@\n a\n')
    expect(hunkStart(d.hunks[0]!)).toEqual({ old: 12, new: 40 })
  })

  it('steps past a zero-length side, which git numbers one line early', () => {
    // `-3,0` means "after old line 3", not "at old line 3". Read literally it
    // leaves the preceding context a line short and skews the rest of the file.
    expect(hunkStart(diffOf('@@ -3,0 +4,2 @@\n+a\n+b\n').hunks[0]!)).toEqual({ old: 4, new: 4 })
    expect(hunkStart(diffOf('@@ -4,2 +3,0 @@\n-a\n-b\n').hunks[0]!)).toEqual({ old: 4, new: 4 })
  })

  it('reads a single-line hunk, which git writes without a count', () => {
    const d = diffOf('@@ -7 +7 @@\n-a\n+b\n')
    expect(hunkStart(d.hunks[0]!)).toEqual({ old: 7, new: 7 })
  })
})

describe('alignFile', () => {
  it('includes the unchanged lines before a hunk, which the diff never mentions', () => {
    // The change is at line 4; lines 1-3 are identical and absent from the diff,
    // but a side-by-side view still has to render them.
    const d = diffOf('@@ -4,1 +4,1 @@\n-old\n+new\n')
    const rows = alignFile(d, 5, 5)
    expect(rows).toHaveLength(5)
    expect(rows[0]!.left!.oldLine).toBe(1)
    expect(rows[3]!.left!.kind).toBe('removed')
    expect(rows[3]!.right!.kind).toBe('added')
  })

  it('includes the unchanged tail after the last hunk', () => {
    const d = diffOf('@@ -1,1 +1,1 @@\n-a\n+b\n')
    // Ten lines each, only the first changed: nine unchanged rows must follow.
    expect(alignFile(d, 10, 10)).toHaveLength(10)
  })

  it('keeps the two sides in step across an insertion', () => {
    const d = diffOf('@@ -2,0 +3,2 @@\n+one\n+two\n')
    const rows = alignFile(d, 4, 6)
    // Two rows have a right side and no left: the inserted pair.
    expect(rows.filter((r) => r.right && !r.left)).toHaveLength(2)
    // And the last row still pairs the two files' last lines.
    const last = rows[rows.length - 1]!
    expect(last.left!.oldLine).toBe(4)
    expect(last.right!.newLine).toBe(6)
  })

  it('returns the whole file as context when nothing changed', () => {
    const rows = alignFile({ hunks: [], binary: false, added: 0, removed: 0 }, 3, 3)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.left && r.right)).toBe(true)
  })

  it('invents no lines for an empty file', () => {
    expect(alignFile({ hunks: [], binary: false, added: 0, removed: 0 }, 0, 0)).toHaveLength(0)
  })
})

describe('padding', () => {
  it('pads the side that is missing a line, above the line that follows it', () => {
    const d = diffOf('@@ -2,0 +3,1 @@\n+inserted\n')
    const rows = alignFile(d, 4, 5)
    const pads = padding(rows, 4, 5)
    // The old file has nothing opposite new line 3, so it needs one filler,
    // sitting above the old line that comes next.
    expect([...pads.left.values()]).toEqual([1])
    expect(pads.right.size).toBe(0)
  })

  it('pads the other way for a deletion', () => {
    const d = diffOf('@@ -3,1 +2,0 @@\n-gone\n')
    const pads = padding(alignFile(d, 5, 4), 5, 4)
    expect([...pads.right.values()]).toEqual([1])
    expect(pads.left.size).toBe(0)
  })

  it('groups a run of insertions into one filler, not several', () => {
    // Three separate fillers would draw three separate hatched blocks with
    // borders between them, which reads as three gaps rather than one.
    const d = diffOf('@@ -2,0 +3,3 @@\n+a\n+b\n+c\n')
    const pads = padding(alignFile(d, 4, 7), 4, 7)
    expect([...pads.left.values()]).toEqual([3])
  })

  it('hangs a gap at the end of the file one line past its last', () => {
    // Appending to a file leaves the old side short with no following line to
    // sit above, which is the only case that needs a key that is not a line.
    const d = diffOf('@@ -3,0 +4,2 @@\n+tail one\n+tail two\n')
    const pads = padding(alignFile(d, 3, 5), 3, 5)
    expect(pads.left.get(4)).toBe(2)
  })

  it('replacing equal numbers of lines needs no padding at all', () => {
    const d = diffOf('@@ -2,2 +2,2 @@\n-a\n-b\n+c\n+d\n')
    const pads = padding(alignFile(d, 4, 4), 4, 4)
    expect(pads.left.size + pads.right.size).toBe(0)
  })
})

describe('changedLines', () => {
  it('reports each side numbered against its own file', () => {
    const d = diffOf('@@ -2,1 +2,2 @@\n-old\n+new\n+extra\n')
    const marks = changedLines(alignFile(d, 3, 4))
    expect(marks.removed).toEqual([2])
    expect(marks.added).toEqual([2, 3])
  })

  it('marks nothing for an unchanged file', () => {
    const marks = changedLines(alignFile({ hunks: [], binary: false, added: 0, removed: 0 }, 4, 4))
    expect(marks).toEqual({ removed: [], added: [] })
  })
})
