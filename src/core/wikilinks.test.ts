import { describe, expect, it } from 'vitest'
import { findLinkLines, findWikilinks, stemMatches } from './wikilinks'

describe('findWikilinks', () => {
  it('parses a plain wikilink', () => {
    const [link] = findWikilinks('see [[My Note]] here')
    expect(link).toMatchObject({ target: 'My Note', heading: null, alias: null })
    expect(link!.from).toBe(4)
    expect(link!.to).toBe(15)
    // Label covers the target text.
    expect('see [[My Note]] here'.slice(link!.labelFrom, link!.labelTo)).toBe('My Note')
  })

  it('parses heading and alias forms', () => {
    const text = '[[Note#Section|shown text]]'
    const [link] = findWikilinks(text)
    expect(link).toMatchObject({ target: 'Note', heading: 'Section', alias: 'shown text' })
    expect(text.slice(link!.labelFrom, link!.labelTo)).toBe('shown text')
  })

  it('parses multiple links and applies offsets', () => {
    const links = findWikilinks('[[a]] and [[b]]', 100)
    expect(links).toHaveLength(2)
    expect(links[0]!.from).toBe(100)
    expect(links[1]!.target).toBe('b')
  })

  it('ignores empty targets and unclosed brackets', () => {
    expect(findWikilinks('[[]] [[  ]] [[unclosed')).toHaveLength(0)
  })

  it('does not span lines', () => {
    expect(findWikilinks('[[first\nsecond]]')).toHaveLength(0)
  })
})

describe('stemMatches', () => {
  it('is case-insensitive and trims', () => {
    expect(stemMatches('My Note', 'my note')).toBe(true)
    expect(stemMatches(' My Note ', 'My Note')).toBe(true)
    expect(stemMatches('Other', 'My Note')).toBe(false)
  })
})

describe('findLinkLines', () => {
  it('reports 1-based line numbers with snippets', () => {
    const content = 'intro\nsee [[Target]] for details\nno link\nalias [[target|t]] too'
    const hits = findLinkLines(content, 'Target')
    expect(hits).toEqual([
      { line: 2, snippet: 'see [[Target]] for details' },
      { line: 4, snippet: 'alias [[target|t]] too' }
    ])
  })

  it('does not match different targets or bare mentions', () => {
    const hits = findLinkLines('mentions Target without link\n[[Other]]', 'Target')
    expect(hits).toHaveLength(0)
  })
})
