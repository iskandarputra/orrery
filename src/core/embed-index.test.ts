import { describe, expect, it } from 'vitest'
import { contentHash, planReindex, type IndexedFile } from './embed-index'

const file = (path: string, content: string, chunks = 1): IndexedFile => ({
  path,
  hash: contentHash(content),
  chunks: Array.from({ length: chunks }, (_, i) => ({
    path,
    line: i + 1,
    text: content,
    vector: [1, 0]
  }))
})

describe('contentHash', () => {
  it('is stable for the same text and differs for changed text', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'))
    expect(contentHash('hello')).not.toBe(contentHash('hello '))
  })
})

describe('planReindex', () => {
  it('re-embeds only what changed', () => {
    const previous = [file('/v/a.md', 'alpha'), file('/v/b.md', 'beta')]
    const plan = planReindex(
      [
        { path: '/v/a.md', content: 'alpha' }, // untouched
        { path: '/v/b.md', content: 'beta v2' } // edited
      ],
      previous
    )
    expect(plan.reuse.map((f) => f.path)).toEqual(['/v/a.md'])
    expect(plan.embed.map((f) => f.path)).toEqual(['/v/b.md'])
    expect(plan.removed).toEqual([])
  })

  it('embeds files it has never seen', () => {
    const plan = planReindex([{ path: '/v/new.md', content: 'fresh' }], [])
    expect(plan.embed.map((f) => f.path)).toEqual(['/v/new.md'])
    expect(plan.reuse).toEqual([])
  })

  it('drops files that no longer exist', () => {
    const plan = planReindex([], [file('/v/gone.md', 'bye')])
    expect(plan.removed).toEqual(['/v/gone.md'])
    expect(plan.reuse).toEqual([])
    expect(plan.embed).toEqual([])
  })

  it('reuses everything when nothing changed', () => {
    const previous = [file('/v/a.md', 'alpha', 3)]
    const plan = planReindex([{ path: '/v/a.md', content: 'alpha' }], previous)
    expect(plan.embed).toEqual([])
    expect(plan.reuse[0]?.chunks).toHaveLength(3)
  })
})
