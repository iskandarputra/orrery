import { describe, expect, it } from 'vitest'
import { changedFileCount, changeTotals } from './change-totals'
import { EMPTY_DIFF_STATS, type DiffStats } from './git-numstat'
import { EMPTY_STATUS, type GitStatus } from './git-status'

const status = (changes: GitStatus['changes']): GitStatus => ({ ...EMPTY_STATUS, changes })
const lines = (insertions: number, deletions: number) => ({ insertions, deletions, binary: false })

describe('changedFileCount', () => {
  it('is nothing for a clean tree', () => {
    expect(changedFileCount(EMPTY_STATUS)).toBe(0)
  })

  it('counts a file staged and then edited again once, not twice', () => {
    const s = status([
      { path: 'both.md', staged: 'modified', unstaged: 'modified' },
      { path: 'staged.md', staged: 'added', unstaged: null },
      { path: 'new.md', staged: null, unstaged: 'untracked' }
    ])
    expect(changedFileCount(s)).toBe(3)
  })

  it('counts a conflict and a rename as the files they are', () => {
    const s = status([
      { path: 'clash.md', staged: null, unstaged: 'conflicted' },
      { path: 'moved.md', staged: 'renamed', unstaged: null, from: 'old.md' }
    ])
    expect(changedFileCount(s)).toBe(2)
  })
})

describe('changeTotals', () => {
  it('adds up the counts on every row, the way the column beside the names does', () => {
    const s = status([
      { path: 'a.md', staged: 'modified', unstaged: null },
      { path: 'b.md', staged: null, unstaged: 'modified' },
      { path: 'new.md', staged: null, unstaged: 'untracked' }
    ])
    const stats: DiffStats = {
      staged: { 'a.md': lines(3, 1) },
      unstaged: { 'b.md': lines(2, 5), 'new.md': lines(10, 0) }
    }
    expect(changeTotals(s, stats)).toEqual({ files: 3, insertions: 15, deletions: 6 })
  })

  it('takes both sides of a file that is on both, which are different edits', () => {
    const s = status([{ path: 'both.md', staged: 'modified', unstaged: 'modified' }])
    const stats: DiffStats = {
      staged: { 'both.md': lines(4, 0) },
      unstaged: { 'both.md': lines(1, 2) }
    }
    expect(changeTotals(s, stats)).toEqual({ files: 1, insertions: 5, deletions: 2 })
  })

  it('does not count a side the file is not listed on', () => {
    // The stats read keys an untracked file into both maps, but it is only
    // ever a row under Unstaged.
    const s = status([{ path: 'new.md', staged: null, unstaged: 'untracked' }])
    const stats: DiffStats = {
      staged: { 'new.md': lines(7, 0) },
      unstaged: { 'new.md': lines(7, 0) }
    }
    expect(changeTotals(s, stats)).toEqual({ files: 1, insertions: 7, deletions: 0 })
  })

  it('adds nothing for a binary file or a count that has not arrived', () => {
    const s = status([
      { path: 'pic.png', staged: null, unstaged: 'modified' },
      { path: 'slow.md', staged: null, unstaged: 'modified' }
    ])
    const stats: DiffStats = {
      staged: {},
      unstaged: { 'pic.png': { insertions: 0, deletions: 0, binary: true } }
    }
    expect(changeTotals(s, stats)).toEqual({ files: 2, insertions: 0, deletions: 0 })
    expect(changeTotals(s, EMPTY_DIFF_STATS).files).toBe(2)
  })
})
