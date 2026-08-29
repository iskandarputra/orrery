import { describe, expect, it } from 'vitest'
import { definitionFor, findFootnotes, numbering } from './footnotes'

const doc = [
  'Some claim.[^1] Another.[^note]',
  '',
  'And the first again.[^1]',
  '',
  '[^1]: The source.',
  '[^note]: A longer aside.',
  '[^unused]: Nobody cited this.'
].join('\n')

describe('findFootnotes', () => {
  it('finds every reference', () => {
    expect(findFootnotes(doc).refs.map((r) => r.label)).toEqual(['1', 'note', '1'])
  })

  it('finds every definition with its text', () => {
    const defs = findFootnotes(doc).defs
    expect(defs.map((d) => d.label)).toEqual(['1', 'note', 'unused'])
    expect(defs[0]!.text).toBe('The source.')
  })

  it('does not read a definition as a reference to itself', () => {
    // `[^1]:` matches the reference pattern too. Counted twice, the label at the
    // bottom of the file renders as a marker pointing at itself.
    const refs = findFootnotes('[^1]: only a definition\n').refs
    expect(refs).toEqual([])
  })

  it('allows a definition to be indented up to three spaces, as markdown does', () => {
    expect(findFootnotes('   [^a]: indented\n').defs).toHaveLength(1)
    expect(findFootnotes('    [^a]: this is code\n').defs).toHaveLength(0)
  })

  it('reports offsets that bracket the marker exactly', () => {
    const { refs } = findFootnotes('ab[^x]cd')
    expect([refs[0]!.from, refs[0]!.to]).toEqual([2, 6])
  })

  it('finds nothing in a document without any', () => {
    expect(findFootnotes('just prose [not a footnote]')).toEqual({ refs: [], defs: [] })
  })
})

describe('numbering', () => {
  it('numbers by first use, not by label', () => {
    // Markdown allows any label; every renderer shows a number.
    const numbers = numbering(findFootnotes(doc))
    expect(numbers.get('1')).toBe(1)
    expect(numbers.get('note')).toBe(2)
  })

  it('gives two references to one label the same number', () => {
    const numbers = numbering(findFootnotes(doc))
    const refs = findFootnotes(doc).refs
    expect(numbers.get(refs[0]!.label)).toBe(numbers.get(refs[2]!.label))
  })

  it('numbers a definition nobody referenced, after the ones that were', () => {
    // Otherwise the list at the bottom renumbers itself whenever a reference is
    // deleted from the prose above.
    expect(numbering(findFootnotes(doc)).get('unused')).toBe(3)
  })

  it('handles a document with none', () => {
    expect(numbering({ refs: [], defs: [] }).size).toBe(0)
  })
})

describe('definitionFor', () => {
  it('finds the definition a reference points at', () => {
    expect(definitionFor(findFootnotes(doc), 'note')?.text).toBe('A longer aside.')
  })

  it('reports null for a reference pointing at nothing', () => {
    expect(definitionFor(findFootnotes('a[^ghost]'), 'ghost')).toBeNull()
  })
})
