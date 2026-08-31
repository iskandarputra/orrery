import { describe, expect, it } from 'vitest'
import { groupTargets, missingGlyphs, objectAt, objectsWithin, type PageObject } from './pdf-edit'

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

describe('groupTargets', () => {
  /** A single-glyph text object, as real PDFs are full of. */
  const glyph = (index: number, left: number, bottom: number, str: string): PageObject => ({
    index,
    kind: 'text',
    bounds: { left, bottom, right: left + 6, top: bottom + 8 },
    text: str
  })

  it('puts characters back into the line they belong to', () => {
    // The case that made this necessary: a page holding 4,662 text objects,
    // one glyph each, which as an editing surface is four thousand boxes and
    // the ability to retype a single letter.
    const targets = groupTargets([
      glyph(0, 72, 700, 'R'),
      glyph(1, 78, 700, 'E'),
      glyph(2, 84, 700, 'N'),
      glyph(3, 90, 700, 'T')
    ])
    expect(targets).toHaveLength(1)
    expect(targets[0]?.text).toBe('RENT')
    expect(targets[0]?.indexes).toEqual([0, 1, 2, 3])
  })

  it('does not double the spaces between words', () => {
    // A glyph is reported with a trailing space when the gap to the next one is
    // wide, and the space is usually an object of its own as well — joined
    // naively, every space in the line comes out doubled, and retyping it would
    // write those doubles into the document.
    const targets = groupTargets([
      glyph(0, 72, 700, 'A '),
      glyph(1, 78, 700, ' '),
      glyph(2, 84, 700, 'B')
    ])
    expect(targets[0]?.text).toBe('A B')
  })

  it('keeps separate lines separate', () => {
    const targets = groupTargets([glyph(0, 72, 700, 'a'), glyph(1, 72, 680, 'b')])
    expect(targets.map((t) => t.text)).toEqual(['a', 'b'])
  })

  it('does not join across a gap wide enough to be a column', () => {
    // Two table cells on one line are two things to edit, and a run spanning
    // both would be text that exists nowhere on the page.
    const targets = groupTargets([glyph(0, 72, 700, 'a'), glyph(1, 300, 700, 'b')])
    expect(targets).toHaveLength(2)
  })

  it('spans the whole line it gathered', () => {
    const [target] = groupTargets([glyph(0, 72, 700, 'a'), glyph(1, 78, 700, 'b')])
    expect(target!.bounds.left).toBe(72)
    expect(target!.bounds.right).toBe(84)
  })

  it('leaves pictures as things of their own', () => {
    const image: PageObject = {
      index: 5,
      kind: 'image',
      bounds: { left: 0, bottom: 0, right: 100, top: 100 },
      text: ''
    }
    const targets = groupTargets([image, glyph(0, 72, 700, 'a')])
    expect(targets.find((t) => t.kind === 'image')?.indexes).toEqual([5])
  })

  it('reads down the page', () => {
    const targets = groupTargets([glyph(0, 72, 100, 'low'), glyph(1, 72, 700, 'high')])
    expect(targets.map((t) => t.text)).toEqual(['high', 'low'])
  })

  it('has nothing to say about an empty page', () => {
    expect(groupTargets([])).toEqual([])
  })
})
