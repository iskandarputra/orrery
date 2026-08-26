import { describe, expect, it } from 'vitest'
import { findEmoji, matchEmojiQuery } from './emoji'

describe('matchEmojiQuery', () => {
  it('triggers at a word boundary', () => {
    expect(matchEmojiQuery(':sm', 3)).toEqual({ from: 0, query: 'sm' })
    expect(matchEmojiQuery('done :ta', 8)).toEqual({ from: 5, query: 'ta' })
  })

  it('ignores a colon in the middle of something', () => {
    expect(matchEmojiQuery('key:value', 9)).toBeNull()
    expect(matchEmojiQuery('https://x.dev', 13)).toBeNull()
    expect(matchEmojiQuery('12:30', 5)).toBeNull()
  })
})

describe('findEmoji', () => {
  it('finds by shortcode', () => {
    expect(findEmoji('rocket')[0]).toEqual({ name: 'rocket', glyph: '🚀' })
  })

  it('puts prefix matches before contains-matches', () => {
    const names = findEmoji('check').map((e) => e.name)
    expect(names[0]!.startsWith('check')).toBe(true)
  })

  it('returns a starter set for an empty query', () => {
    expect(findEmoji('').length).toBeGreaterThan(5)
  })

  it('returns nothing for nonsense rather than everything', () => {
    expect(findEmoji('zzzznope')).toEqual([])
  })
})
