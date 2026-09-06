import { describe, expect, it } from 'vitest'
import { rankCandidates, resolve } from './link-resolution'

describe('rankCandidates', () => {
  it("prefers the candidate in the linking file's own folder", () => {
    // `archive` sorts before `notes`, so a comparator that ignored the linking
    // file would answer archive. That is the whole point of the fixture.
    const ranked = rankCandidates('/v/notes/A.md', ['/v/archive/store.md', '/v/notes/store.md'])
    expect(ranked[0]).toBe('/v/notes/store.md')
  })

  it('falls back to the nearest shared folder', () => {
    const ranked = rankCandidates('/v/zeta/deep/A.md', ['/v/alpha/store.md', '/v/zeta/store.md'])
    expect(ranked[0]).toBe('/v/zeta/store.md')
  })

  it('falls back to the shallowest path when nothing is nearer', () => {
    const ranked = rankCandidates('/v/A.md', ['/v/a/b/c/store.md', '/v/z/store.md'])
    expect(ranked[0]).toBe('/v/z/store.md')
  })

  it('depends on the linking file, not only on the candidates', () => {
    // The same two candidates, ranked from two places, must give two answers.
    // No implementation that ignores `fromPath` can pass this one.
    const candidates = ['/v/archive/store.md', '/v/notes/store.md']
    expect(rankCandidates('/v/notes/A.md', candidates)[0]).toBe('/v/notes/store.md')
    expect(rankCandidates('/v/archive/A.md', candidates)[0]).toBe('/v/archive/store.md')
  })

  it('orders totally, so the input order cannot change the answer', () => {
    // The bug this whole change exists for: `resolveNote` took the first stem
    // match in the directory walk and `buildGraph` kept the last, so the same
    // link opened one file and drew an edge to another.
    const candidates = ['/v/archive/store.md', '/v/notes/store.md', '/v/zz/store.md']
    const forwards = rankCandidates('/v/notes/A.md', candidates)
    const backwards = rankCandidates('/v/notes/A.md', [...candidates].reverse())
    expect(backwards).toEqual(forwards)
    expect(forwards).toEqual(['/v/notes/store.md', '/v/archive/store.md', '/v/zz/store.md'])
  })
})

describe('resolve', () => {
  it('hands back the only candidate without calling it ambiguous', () => {
    expect(
      resolve('/v/A.md', ['/v/B.md'], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: 'B' }
      })
    ).toEqual({
      status: 'resolved',
      to: '/v/B.md',
      ambiguous: false
    })
  })

  it('picks the nearest and says a choice was made', () => {
    expect(
      resolve('/v/notes/A.md', ['/v/archive/store.md', '/v/notes/store.md'], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: 'store' }
      })
    ).toEqual({ status: 'resolved', to: '/v/notes/store.md', ambiguous: true })
  })

  it('refuses when asked to, and ranks what it refused', () => {
    const found = resolve('/v/b/main.rs', ['/v/a/pane.rs', '/v/b/pane.rs'], {
      tieBreak: 'refuse',
      whenEmpty: { status: 'external' }
    })
    expect(found).toEqual({ status: 'ambiguous', candidates: ['/v/b/pane.rs', '/v/a/pane.rs'] })
  })

  it("returns the caller's own answer for no candidates at all", () => {
    expect(
      resolve('/v/A.md', [], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: 'Nowhere' }
      })
    ).toEqual({ status: 'missing', at: 'Nowhere' })
    expect(
      resolve('/v/a.ts', [], { tieBreak: 'refuse', whenEmpty: { status: 'external' } })
    ).toEqual({ status: 'external' })
  })
})
