import { describe, expect, it } from 'vitest'
import { missingGlyphs, objectAt, objectsWithin, type PageObject } from './pdf-edit'

const object = (
  index: number,
  left: number,
  bottom: number,
  right: number,
  top: number,
  text = ''
): PageObject => ({
  index,
  kind: text ? 'text' : 'path',
  bounds: { left, bottom, right, top },
  text
})

describe('missingGlyphs', () => {
  it('says nothing when every character is already in the document', () => {
    expect(missingGlyphs('the quick brown fox', 'the fox')).toEqual([])
  })

  it('names the characters the document has never drawn', () => {
    // Most PDFs embed only the glyphs they use, so a character the document
    // has never contained probably has no glyph to draw.
    expect(missingGlyphs('hello world', 'hello Ž')).toEqual(['Ž'])
  })

  it('reports each unknown character once, however often it is typed', () => {
    expect(missingGlyphs('abc', 'zzz')).toEqual(['z'])
  })

  it('never complains about whitespace', () => {
    // A space is not drawn, so it cannot be missing — and warning about one
    // would turn the warning into noise.
    expect(missingGlyphs('abc', 'a b\tc\n')).toEqual([])
  })

  it('says nothing at all when there is no evidence either way', () => {
    // An empty alphabet is not a document that draws nothing — it is a
    // document whose text has not been read yet, or a scan that has none.
    // Warning about every character typed would be true, useless and alarming.
    expect(missingGlyphs('', 'a')).toEqual([])
  })
})

describe('objectAt', () => {
  it('finds the object under the point', () => {
    expect(objectAt([object(0, 0, 0, 100, 100)], 50, 50)?.index).toBe(0)
  })

  it('prefers the smallest of the objects that overlap there', () => {
    // A line of text sits inside the box drawn behind it, and clicking the
    // words should get the words.
    const box = object(0, 0, 0, 200, 200)
    const words = object(1, 10, 10, 60, 30, 'hello')
    expect(objectAt([box, words], 20, 20)?.index).toBe(1)
  })

  it('finds nothing where there is nothing', () => {
    expect(objectAt([object(0, 0, 0, 10, 10)], 50, 50)).toBeNull()
  })
})

describe('objectsWithin', () => {
  const rect = { left: 40, bottom: 40, right: 60, top: 60 }

  it('takes anything the rectangle touches, not only what it swallows', () => {
    // A redaction that left half a word behind because the box clipped it
    // would be worse than useless: it would look like the words were gone.
    const clipped = object(0, 50, 50, 500, 70, 'secret and then some')
    expect(objectsWithin([clipped], rect).map((o) => o.index)).toEqual([0])
  })

  it('leaves alone what the rectangle misses', () => {
    expect(objectsWithin([object(0, 0, 0, 20, 20)], rect)).toEqual([])
  })

  it('does not count an object that merely shares an edge', () => {
    expect(objectsWithin([object(0, 60, 40, 80, 60)], rect)).toEqual([])
  })
})
