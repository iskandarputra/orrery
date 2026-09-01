import { describe, expect, it } from 'vitest'
import { prune, shouldSnapshot, type Snapshot } from './history'

const MINUTE = 60_000
const snap = (id: string, at: number): Snapshot => ({ id, at, bytes: 10 })

describe('shouldSnapshot', () => {
  const now = 10 * MINUTE

  it('keeps the first version of a note', () => {
    expect(shouldSnapshot({ last: null, next: 'hello', now })).toBe(true)
  })

  it('skips a save that changed nothing', () => {
    expect(
      shouldSnapshot({ last: { content: 'same', at: now - 5 * MINUTE }, next: 'same', now })
    ).toBe(false)
  })

  it('skips rapid saves, so autosave does not make hundreds of versions', () => {
    expect(shouldSnapshot({ last: { content: 'a', at: now - 30_000 }, next: 'ab', now })).toBe(
      false
    )
  })

  it('takes one once the gap has passed', () => {
    expect(shouldSnapshot({ last: { content: 'a', at: now - 3 * MINUTE }, next: 'ab', now })).toBe(
      true
    )
  })

  it('always keeps a big change, however soon it lands', () => {
    // Losing a rewrite because it happened a minute after the last save is
    // exactly the case history exists for.
    const last = { content: 'a'.repeat(4000), at: now - 5_000 }
    expect(shouldSnapshot({ last, next: 'totally different', now })).toBe(true)
  })
})

describe('prune', () => {
  const now = 100 * MINUTE

  it('keeps everything under the limits', () => {
    const kept = [snap('a', now - MINUTE), snap('b', now - 2 * MINUTE)]
    expect(prune(kept, { keep: 10, maxAgeMs: 60 * MINUTE, now })).toEqual([])
  })

  it('drops the oldest beyond the count', () => {
    const all = [snap('new', now), snap('mid', now - MINUTE), snap('old', now - 2 * MINUTE)]
    expect(prune(all, { keep: 2, maxAgeMs: 60 * MINUTE, now }).map((s) => s.id)).toEqual(['old'])
  })

  it('drops anything past the age, whatever the order it arrives in', () => {
    const all = [snap('ancient', now - 90 * MINUTE), snap('fresh', now - MINUTE)]
    expect(prune(all, { keep: 10, maxAgeMs: 60 * MINUTE, now }).map((s) => s.id)).toEqual([
      'ancient'
    ])
  })

  it('never drops the most recent, however old it is', () => {
    // A note untouched for a year still deserves its last version.
    const all = [snap('only', now - 500 * MINUTE)]
    expect(prune(all, { keep: 5, maxAgeMs: 60 * MINUTE, now })).toEqual([])
  })

  it('has nothing to do for an empty history', () => {
    expect(prune([], { keep: 5, maxAgeMs: MINUTE, now })).toEqual([])
  })
})
