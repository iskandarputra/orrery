import { describe, expect, it } from 'vitest'
import { changedFileCount, sectionTotals } from './change-totals'
import { EMPTY_STATUS, type GitChange, type GitStatus } from './git-status'

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

describe('sectionTotals', () => {
  it("adds up the counts on a section's rows, the way its column does", () => {
    const rows: GitChange[] = [
      { path: 'b.md', staged: null, unstaged: 'modified' },
      { path: 'new.md', staged: null, unstaged: 'untracked' }
    ]
    const stats = { 'b.md': lines(2, 5), 'new.md': lines(10, 0), 'elsewhere.md': lines(9, 9) }
    // A count for a file not in this section is not this section's.
    expect(sectionTotals(rows, stats)).toEqual({ files: 2, insertions: 12, deletions: 5 })
  })

  it("counts a file staged and edited again in each section with that side's lines", () => {
    const both: GitChange = { path: 'both.md', staged: 'modified', unstaged: 'modified' }
    expect(sectionTotals([both], { 'both.md': lines(4, 0) })).toEqual({
      files: 1,
      insertions: 4,
      deletions: 0
    })
    expect(sectionTotals([both], { 'both.md': lines(1, 2) })).toEqual({
      files: 1,
      insertions: 1,
      deletions: 2
    })
  })

  it('adds nothing for a binary file or a count that has not arrived', () => {
    const rows: GitChange[] = [
      { path: 'pic.png', staged: null, unstaged: 'modified' },
      { path: 'slow.md', staged: null, unstaged: 'modified' }
    ]
    const stats = { 'pic.png': { insertions: 0, deletions: 0, binary: true } }
    expect(sectionTotals(rows, stats)).toEqual({ files: 2, insertions: 0, deletions: 0 })
    expect(sectionTotals([], {})).toEqual({ files: 0, insertions: 0, deletions: 0 })
  })
})
