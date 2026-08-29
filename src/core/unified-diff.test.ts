import { describe, expect, it } from 'vitest'
import { alignHunk, parseUnifiedDiff } from './unified-diff'

const diff = (...lines: string[]): string => lines.join('\n')

const HEADER = [
  'diff --git a/note.md b/note.md',
  'index 83db48f..bf269f4 100644',
  '--- a/note.md',
  '+++ b/note.md'
]

describe('parseUnifiedDiff', () => {
  it('tags each line and numbers it in the file it belongs to', () => {
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'))
    expect(d.hunks).toHaveLength(1)
    expect(d.hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: 'two', oldLine: 2, newLine: null },
      { kind: 'added', text: 'TWO', oldLine: null, newLine: 2 },
      { kind: 'context', text: 'three', oldLine: 3, newLine: 3 }
    ])
  })

  it('counts additions and removals', () => {
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -1,1 +1,3 @@', ' a', '+b', '+c', '-d'))
    expect(d).toMatchObject({ added: 2, removed: 1 })
  })

  it('keeps several hunks apart and restarts numbering from each header', () => {
    const d = parseUnifiedDiff(
      diff(...HEADER, '@@ -1,1 +1,1 @@', '-a', '+A', '@@ -10,1 +10,1 @@', '-j', '+J')
    )
    expect(d.hunks).toHaveLength(2)
    expect(d.hunks[1]!.lines[0]).toMatchObject({ kind: 'removed', oldLine: 10 })
    expect(d.hunks[1]!.lines[1]).toMatchObject({ kind: 'added', newLine: 10 })
  })

  it('keeps the hunk header, including a trailing section heading', () => {
    const d = parseUnifiedDiff(
      diff(...HEADER, '@@ -5,2 +5,2 @@ function add() {', ' a', '-b', '+B')
    )
    expect(d.hunks[0]!.header).toBe('@@ -5,2 +5,2 @@ function add() {')
  })

  it('accepts a header with no line count, which git omits when it is 1', () => {
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -3 +3 @@', '-x', '+y'))
    expect(d.hunks[0]!.lines[0]).toMatchObject({ oldLine: 3 })
  })

  it('ignores the no-newline marker rather than numbering it', () => {
    const d = parseUnifiedDiff(
      diff(
        ...HEADER,
        '@@ -1,1 +1,1 @@',
        '-a',
        '\\ No newline at end of file',
        '+a',
        '\\ No newline at end of file'
      )
    )
    expect(d.hunks[0]!.lines.map((l) => l.kind)).toEqual(['removed', 'added'])
  })

  it('preserves an empty context line', () => {
    // A blank line in the file arrives as a single space; slicing it must not
    // drop the line entirely.
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -1,2 +1,2 @@', ' ', '+added'))
    expect(d.hunks[0]!.lines[0]).toEqual({ kind: 'context', text: '', oldLine: 1, newLine: 1 })
  })

  it('preserves leading whitespace in the content', () => {
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -1,1 +1,1 @@', '+    indented'))
    expect(d.hunks[0]!.lines[0]!.text).toBe('    indented')
  })

  it('reports a binary file rather than inventing lines', () => {
    const d = parseUnifiedDiff(
      diff('diff --git a/x.png b/x.png', 'Binary files a/x.png and b/x.png differ')
    )
    expect(d.binary).toBe(true)
    expect(d.hunks).toEqual([])
  })

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toMatchObject({ hunks: [], added: 0, removed: 0 })
  })

  it('ignores header noise before the first hunk', () => {
    const d = parseUnifiedDiff(
      diff(
        'diff --git a/a b/b',
        'similarity index 95%',
        'rename from a',
        'rename to b',
        '@@ -1 +1 @@',
        '-x',
        '+y'
      )
    )
    expect(d.hunks).toHaveLength(1)
    expect(d.added).toBe(1)
  })

  it('handles a pure addition, as a new file produces', () => {
    const d = parseUnifiedDiff(diff(...HEADER, '@@ -0,0 +1,2 @@', '+first', '+second'))
    expect(d.hunks[0]!.lines.map((l) => l.newLine)).toEqual([1, 2])
    expect(d.removed).toBe(0)
  })
})

describe('alignHunk', () => {
  const rowsOf = (...lines: string[]): ReturnType<typeof alignHunk> =>
    alignHunk(parseUnifiedDiff(diff(...HEADER, ...lines)).hunks[0]!)

  it('puts a context line in both columns', () => {
    const [row] = rowsOf('@@ -1,1 +1,1 @@', ' same')
    expect(row!.left!.text).toBe('same')
    expect(row!.right!.text).toBe('same')
  })

  it('sits a replaced line opposite the line that replaced it', () => {
    const rows = rowsOf('@@ -1,1 +1,1 @@', '-old', '+new')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.left!.text).toBe('old')
    expect(rows[0]!.right!.text).toBe('new')
  })

  it('leaves the left column empty for a pure insertion', () => {
    const rows = rowsOf('@@ -1,1 +1,2 @@', ' keep', '+inserted')
    expect(rows[1]).toEqual({ left: null, right: expect.objectContaining({ text: 'inserted' }) })
  })

  it('leaves the right column empty for a pure deletion', () => {
    const rows = rowsOf('@@ -1,2 +1,1 @@', ' keep', '-gone')
    expect(rows[1]).toEqual({ left: expect.objectContaining({ text: 'gone' }), right: null })
  })

  it('pads the shorter side when more was added than removed', () => {
    const rows = rowsOf('@@ -1,1 +1,3 @@', '-one', '+a', '+b', '+c')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.left!.text).toBe('one')
    expect(rows[1]!.left).toBeNull()
    expect(rows[2]!.left).toBeNull()
    expect(rows.map((r) => r.right!.text)).toEqual(['a', 'b', 'c'])
  })

  it('pads the shorter side when more was removed than added', () => {
    const rows = rowsOf('@@ -1,3 +1,1 @@', '-a', '-b', '-c', '+one')
    expect(rows).toHaveLength(3)
    expect(rows[1]!.right).toBeNull()
    expect(rows.map((r) => r.left!.text)).toEqual(['a', 'b', 'c'])
  })

  it('keeps later context aligned after an uneven change', () => {
    // The row count must not drift, or every line below a change is misaligned.
    const rows = rowsOf('@@ -1,3 +1,4 @@', ' top', '-x', '+y', '+z', ' bottom')
    expect(rows).toHaveLength(4)
    expect(rows[3]!.left!.text).toBe('bottom')
    expect(rows[3]!.right!.text).toBe('bottom')
  })

  it('returns nothing for an empty hunk', () => {
    expect(alignHunk({ header: '@@ -0,0 +0,0 @@', lines: [] })).toEqual([])
  })
})
