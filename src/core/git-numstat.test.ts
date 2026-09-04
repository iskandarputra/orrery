import { describe, expect, it } from 'vitest'
import { countLines, parseNumstat } from './git-numstat'

/** Records as git writes them: two counts, a path, and a NUL after each. */
const rec = (add: string, del: string, path: string): string => `${add}\t${del}\t${path}\0`

describe('parseNumstat', () => {
  it('reads the counts for each file', () => {
    const out = rec('15', '0', 'README.md') + rec('26', '3', 'src/core/asset.ts')
    expect(parseNumstat(out)).toEqual({
      'README.md': { insertions: 15, deletions: 0, binary: false },
      'src/core/asset.ts': { insertions: 26, deletions: 3, binary: false }
    })
  })

  it('records a rename under the name it now has', () => {
    // The path field is empty and the two paths follow as their own fields —
    // the shape that makes this a walk rather than a map.
    const out =
      rec('12', '0', 'src/main/index.ts') +
      '0\t0\t\0e2e/fixtures/make-pdf.ts\0src/main/services/make-pdf.ts\0' +
      rec('3', '1', 'package.json')
    const stats = parseNumstat(out)
    expect(Object.keys(stats)).toEqual([
      'src/main/index.ts',
      'src/main/services/make-pdf.ts',
      'package.json'
    ])
    // The record after the rename is not swallowed by it.
    expect(stats['package.json']).toEqual({ insertions: 3, deletions: 1, binary: false })
    // And the old name is not reported as a file of its own.
    expect(stats['e2e/fixtures/make-pdf.ts']).toBeUndefined()
  })

  it('marks a binary file rather than calling it an empty change', () => {
    const stats = parseNumstat(rec('-', '-', 'logo.png'))
    expect(stats['logo.png']).toEqual({ insertions: 0, deletions: 0, binary: true })
  })

  it('keeps a path that contains a newline', () => {
    // The whole reason for -z. A `.` that does not match a newline would cut
    // the path in half and file the change under a name nobody has.
    const stats = parseNumstat(rec('1', '2', 'notes/two\nlines.md'))
    expect(stats['notes/two\nlines.md']).toEqual({ insertions: 1, deletions: 2, binary: false })
  })

  it('keeps a path that contains a tab', () => {
    const stats = parseNumstat(rec('4', '0', 'notes/tab\there.md'))
    expect(stats['notes/tab\there.md']).toEqual({ insertions: 4, deletions: 0, binary: false })
  })

  it('answers nothing for a repository with no changes', () => {
    expect(parseNumstat('')).toEqual({})
  })

  it('ignores a line that is not a record', () => {
    expect(parseNumstat('warning: something\0' + rec('1', '1', 'a.ts'))).toEqual({
      'a.ts': { insertions: 1, deletions: 1, binary: false }
    })
  })

  it('survives a rename record that was cut short', () => {
    // A truncated read must not throw, and must not invent a file called "".
    expect(parseNumstat('0\t0\t\0only-one-path.ts\0')).toEqual({})
  })
})

describe('countLines', () => {
  it('counts a trailing newline as ending the last line, not starting one', () => {
    expect(countLines('a\nb\nc\n')).toBe(3)
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('is zero for an empty file', () => {
    expect(countLines('')).toBe(0)
  })

  it('counts a single unterminated line', () => {
    expect(countLines('no newline here')).toBe(1)
  })

  it('counts blank lines, because git does', () => {
    expect(countLines('\n\n\n')).toBe(3)
  })
})
