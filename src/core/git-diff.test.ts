import { describe, expect, it } from 'vitest'
import { parseDiffHunks } from './git-diff'

describe('parseDiffHunks', () => {
  it('marks a pure insertion as added', () => {
    // Three lines added at line 5, nothing removed.
    expect(parseDiffHunks('@@ -4,0 +5,3 @@')).toEqual([
      { line: 5, kind: 'added' },
      { line: 6, kind: 'added' },
      { line: 7, kind: 'added' }
    ])
  })

  it('marks a replacement as modified', () => {
    expect(parseDiffHunks('@@ -10,2 +10,2 @@')).toEqual([
      { line: 10, kind: 'modified' },
      { line: 11, kind: 'modified' }
    ])
  })

  it('marks a deletion once, on the line it followed', () => {
    // Three lines removed after line 4; there is nothing left to underline.
    expect(parseDiffHunks('@@ -5,3 +4,0 @@')).toEqual([{ line: 4, kind: 'removed' }])
  })

  it('keeps a deletion from the very top on a real line', () => {
    expect(parseDiffHunks('@@ -1,2 +0,0 @@')).toEqual([{ line: 1, kind: 'removed' }])
  })

  it('reads an omitted count as one', () => {
    expect(parseDiffHunks('@@ -3 +3 @@')).toEqual([{ line: 3, kind: 'modified' }])
    expect(parseDiffHunks('@@ -2,0 +3 @@')).toEqual([{ line: 3, kind: 'added' }])
  })

  it('handles several hunks in one diff, ignoring everything else', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 83db48f..bf269f4 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2,1 @@',
      '+added line',
      '@@ -8,1 +9,1 @@',
      '-old',
      '+new'
    ].join('\n')
    expect(parseDiffHunks(diff)).toEqual([
      { line: 2, kind: 'added' },
      { line: 9, kind: 'modified' }
    ])
  })

  it('splits a grown hunk into the overlap and the surplus', () => {
    // Git merges adjacent edits: one line replaced by three is a single hunk.
    // The first replaced something; the other two are genuinely new.
    expect(parseDiffHunks('@@ -2,1 +2,3 @@')).toEqual([
      { line: 2, kind: 'modified' },
      { line: 3, kind: 'added' },
      { line: 4, kind: 'added' }
    ])
  })

  it('reports a shrunk hunk as modified throughout', () => {
    // Three lines replaced by one: nothing here is an addition.
    expect(parseDiffHunks('@@ -2,3 +2,1 @@')).toEqual([{ line: 2, kind: 'modified' }])
  })

  it('returns nothing for an empty diff', () => {
    expect(parseDiffHunks('')).toEqual([])
  })
})
