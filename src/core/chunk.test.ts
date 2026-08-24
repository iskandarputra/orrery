import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from './chunk'
import { cosineSimilarity, topK } from './vector'

describe('chunkMarkdown', () => {
  it('splits on blank lines with 1-based start lines', () => {
    const doc = 'First para line one.\nline two.\n\nSecond para.'
    const chunks = chunkMarkdown(doc, 1000)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ line: 1 })
    expect(chunks[0]!.text).toContain('First para')
    expect(chunks[1]!.text).toBe('Second para.')
    expect(chunks[1]!.line).toBe(4)
  })

  it('breaks accumulated lines at the char budget', () => {
    const doc = Array.from({ length: 60 }, (_, i) => `sentence number ${i} here`).join('\n')
    const chunks = chunkMarkdown(doc, 300)
    expect(chunks.length).toBeGreaterThan(1)
    // Every chunk stays near the budget (one line may overshoot).
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThan(400)
  })

  it('drops empty content', () => {
    expect(chunkMarkdown('\n\n\n')).toEqual([])
  })
})

describe('vector math', () => {
  it('cosineSimilarity: identical vectors = 1, orthogonal = 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('cosineSimilarity guards mismatched/empty', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('topK ranks by score', () => {
    expect(topK(['a', 'bb', 'ccc'], (s) => s.length, 2)).toEqual(['ccc', 'bb'])
  })
})
