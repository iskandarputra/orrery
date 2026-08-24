import { describe, expect, it } from 'vitest'
import { pushRecent } from './recent'

describe('pushRecent', () => {
  it('prepends new items', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an existing item to the front instead of duplicating', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('caps the list length', () => {
    const list = Array.from({ length: 15 }, (_, i) => `f${i}`)
    const next = pushRecent(list, 'new')
    expect(next).toHaveLength(15)
    expect(next[0]).toBe('new')
    expect(next).not.toContain('f14')
  })
})
