import { describe, expect, it } from 'vitest'
import { linesFrom, pageFromAnchor, pageText, quoteFromPdf, snippet } from './pdf-text'

/** A text run, positioned the way pdf.js reports one. */
const run = (str: string, x: number, y: number, width = str.length * 5): TextRun => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width
})

type TextRun = { str: string; transform: number[]; width: number }

describe('linesFrom', () => {
  it('reads down the page, not in the order the runs were drawn', () => {
    // A PDF may draw a page in any order at all; a two-column paper often draws
    // one whole column before the other.
    const lines = linesFrom([run('second line', 72, 700), run('first line', 72, 720)])
    expect(lines).toEqual(['first line', 'second line'])
  })

  it('joins runs that share a baseline, in the order they sit across the page', () => {
    const lines = linesFrom([run('world', 130, 700, 30), run('hello', 72, 700, 30)])
    expect(lines).toEqual(['hello world'])
  })

  it('keeps a word whole when the runs are touching', () => {
    // Kerning splits a word into several runs with no gap between them, and a
    // space inserted there breaks the word the search is looking for.
    expect(linesFrom([run('ki', 72, 700, 10), run('te', 82, 700, 10)])).toEqual(['kite'])
  })

  it('does not double a space that is already there', () => {
    expect(linesFrom([run('hello ', 72, 700, 34), run('world', 130, 700, 30)])).toEqual([
      'hello world'
    ])
  })

  it('holds a line together when its baselines differ slightly', () => {
    // A superscript, a formula or a change of font size moves the baseline by a
    // fraction of a point; demanding an exact match splits the sentence.
    expect(linesFrom([run('x', 72, 700, 6), run('2', 79, 701.4, 4)])).toEqual(['x2'])
  })

  it('separates lines that are genuinely apart', () => {
    expect(linesFrom([run('one', 72, 700), run('two', 72, 690)])).toHaveLength(2)
  })

  it('drops runs with nothing in them', () => {
    expect(linesFrom([run('', 72, 700), run('   ', 72, 690), run('real', 72, 680)])).toEqual([
      'real'
    ])
  })

  it('gives a whole page as text with its lines in order', () => {
    expect(pageText([run('below', 72, 690), run('above', 72, 720)])).toBe('above\nbelow')
  })
})

describe('snippet', () => {
  it('leaves a short line exactly as it is', () => {
    expect(snippet('a short line', 2, 5)).toBe('a short line')
  })

  it('trims around the match and marks where it cut', () => {
    const line = `${'lorem ipsum '.repeat(20)}kestrel${' dolor sit'.repeat(20)}`
    const cut = snippet(line, line.indexOf('kestrel'), 7)
    expect(cut).toContain('kestrel')
    expect(cut.length).toBeLessThan(140)
    expect(cut.startsWith('…')).toBe(true)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('does not begin or end in the middle of a word', () => {
    const line = `${'lorem ipsum '.repeat(20)}kestrel${' dolor sit'.repeat(20)}`
    const cut = snippet(line, line.indexOf('kestrel'), 7).replace(/^…|…$/g, '')
    const at = line.indexOf(cut)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at === 0 || line[at - 1] === ' ').toBe(true)
    const after = at + cut.length
    expect(after === line.length || line[after] === ' ').toBe(true)
  })
})

describe('pageFromAnchor', () => {
  it('reads the fragment every PDF viewer already uses', () => {
    expect(pageFromAnchor('page=12')).toBe(12)
    expect(pageFromAnchor(' PAGE = 3 ')).toBe(3)
  })

  it('refuses anything that is not a page, rather than guessing at page one', () => {
    // A heading anchor meant for a note, or a typo: sending someone to the
    // front of a three-hundred-page document is not a helpful fallback.
    expect(pageFromAnchor('Introduction')).toBeNull()
    expect(pageFromAnchor('page=0')).toBeNull()
    expect(pageFromAnchor('page=-2')).toBeNull()
    expect(pageFromAnchor('page=two')).toBeNull()
    expect(pageFromAnchor(null)).toBeNull()
  })
})

describe('quoteFromPdf', () => {
  it('quotes the words and links back to the page they came from', () => {
    const quote = quoteFromPdf('The kestrel hovers.', 'paper.pdf', 12)
    expect(quote).toContain('> The kestrel hovers.')
    expect(quote).toContain('[[paper.pdf#page=12]]')
  })

  it("joins the lines a column broke, because they are not the author's", () => {
    // A paragraph in a PDF is broken wherever the column ended; pasted with
    // those breaks it reads as poetry.
    expect(quoteFromPdf('The kestrel\nhovers over\nthe field.', 'p.pdf', 1)).toContain(
      '> The kestrel hovers over the field.'
    )
  })

  it('closes up a word the column split, keeping the hyphen it had', () => {
    // Deciding whether that hyphen belongs to the word or to the typesetting
    // needs a dictionary. Keeping it leaves something visibly odd that anyone
    // can fix; dropping it can silently invent a word.
    expect(quoteFromPdf('optical charac-\nter recognition', 'p.pdf', 1)).toContain(
      '> optical charac-ter recognition'
    )
  })

  it('and so leaves a real compound intact', () => {
    expect(quoteFromPdf('a well-\nknown result', 'p.pdf', 1)).toContain('> a well-known result')
  })

  it('drops the blank lines a page is full of', () => {
    expect(quoteFromPdf('One.\n\n\nTwo.', 'p.pdf', 3)).toContain('> One. Two.')
  })
})
