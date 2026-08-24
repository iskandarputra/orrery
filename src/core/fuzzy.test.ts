import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively, rejects non-matches', () => {
    expect(fuzzyScore('gap', 'Gap Analysis')).not.toBeNull()
    expect(fuzzyScore('gan', 'Gap Analysis')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Gap Analysis')).toBeNull()
  })

  it('prefers word-start and consecutive matches', () => {
    expect(fuzzyScore('ga', 'Gap Analysis')!).toBeGreaterThan(fuzzyScore('ga', 'megabyte')!)
  })
})

describe('fuzzyFilter', () => {
  const items = ['Toggle Sidebar', 'Toggle Outline Panel', 'Save', 'Open Graph View']
  it('ranks and filters', () => {
    const r = fuzzyFilter('tog', items, (s) => s)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatch(/^Toggle/)
  })
  it('returns head of list for empty query', () => {
    expect(fuzzyFilter('', items, (s) => s)).toHaveLength(4)
  })
})
