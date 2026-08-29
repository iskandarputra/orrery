import { describe, expect, it } from 'vitest'
import { isNoteId, noteId, pickRandom } from './note-ids'

describe('noteId', () => {
  it('is twelve digits, largest field first, so it sorts by time', () => {
    const id = noteId(new Date(2026, 7, 30, 9, 5))
    expect(id).toBe('202608300905')
    expect(id).toMatch(/^\d{12}$/)
  })

  it('pads every field, so ordering is by string as well as by date', () => {
    const early = noteId(new Date(2026, 0, 2, 3, 4))
    const later = noteId(new Date(2026, 10, 20, 13, 40))
    expect(early).toBe('202601020304')
    expect(early < later).toBe(true)
  })

  it('uses local time, so a morning note is not stamped with last night', () => {
    // The identifier is read by a person and matched against when they wrote it.
    const id = noteId(new Date(2026, 7, 30, 0, 30))
    expect(id.slice(0, 8)).toBe('20260830')
  })
})

describe('isNoteId', () => {
  it('recognises one, and nothing else', () => {
    expect(isNoteId('202608300905')).toBe(true)
    expect(isNoteId('20260830')).toBe(false)
    expect(isNoteId('2026083009050')).toBe(false)
    expect(isNoteId('Meeting notes')).toBe(false)
    expect(isNoteId('')).toBe(false)
  })
})

describe('pickRandom', () => {
  it('picks the item the roll lands on', () => {
    expect(pickRandom(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickRandom(['a', 'b', 'c'], () => 0.5)).toBe('b')
    expect(pickRandom(['a', 'b', 'c'], () => 0.99)).toBe('c')
  })

  it('never runs off the end when the roll returns exactly 1', () => {
    // Math.random() is documented as below 1, but a caller's generator may not
    // be, and an out-of-range index here would open nothing at all.
    expect(pickRandom(['a', 'b'], () => 1)).toBe('b')
  })

  it('returns null for an empty vault rather than throwing', () => {
    expect(pickRandom([], () => 0)).toBeNull()
  })
})
