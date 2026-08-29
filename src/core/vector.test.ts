import { describe, expect, it } from 'vitest'
import { cosineSimilarity, topK } from './vector'

describe('cosineSimilarity', () => {
  it('is 1 for identical directions and 0 for perpendicular ones', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('ignores magnitude, which is the point of using cosine', () => {
    // Two notes about the same thing at different lengths are still about the
    // same thing.
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1)
  })

  it('is -1 for opposed vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1)
  })

  it('returns 0 rather than NaN for a zero vector', () => {
    // A note whose embedding is all zeros must not poison a ranking with NaN,
    // which sorts unpredictably.
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('returns 0 for mismatched or empty input', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe('topK', () => {
  const items = ['a', 'bbb', 'cc', 'dddd']
  const byLength = (s: string): number => s.length

  it('returns the highest scoring, highest first', () => {
    expect(topK(items, byLength, 2)).toEqual(['dddd', 'bbb'])
  })

  it('returns everything when k exceeds the list', () => {
    expect(topK(items, byLength, 99)).toHaveLength(4)
  })

  it('returns nothing for k of zero or less', () => {
    expect(topK(items, byLength, 0)).toEqual([])
    expect(topK(items, byLength, -1)).toEqual([])
  })

  it('handles an empty list', () => {
    expect(topK([], byLength, 3)).toEqual([])
  })
})
