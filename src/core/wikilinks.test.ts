import { describe, expect, it } from 'vitest'
import { findWikilinks, stemMatches } from './wikilinks'

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

describe('embeds', () => {
  it('marks ![[Note]] as an embed and includes the bang in the range', () => {
    const text = 'see ![[Note]] here'
    const [match] = findWikilinks(text)
    expect(match).toMatchObject({ target: 'Note', embed: true })
    expect(text.slice(match!.from, match!.to)).toBe('![[Note]]')
  })

  it('leaves a plain link alone', () => {
    const [match] = findWikilinks('see [[Note]] here')
    expect(match!.embed).toBe(false)
  })

  it('keeps the label offsets right for an embed', () => {
    const text = '![[Note|Alias]]'
    const [match] = findWikilinks(text)
    expect(text.slice(match!.labelFrom, match!.labelTo)).toBe('Alias')
  })

  it('carries the heading through', () => {
    const [match] = findWikilinks('![[Note#Section]]')
    expect(match).toMatchObject({ target: 'Note', heading: 'Section', embed: true })
  })

  it('is not fooled by a bang that belongs to the previous word', () => {
    const [match] = findWikilinks('wow! [[Note]]')
    expect(match!.embed).toBe(false)
  })
})

describe('code is not a link', () => {
  const targets = (text: string): string[] => findWikilinks(text).map((w) => w.target)

  it('ignores a wikilink inside a fenced block', () => {
    // A mermaid diagram or a snippet showing the syntax would otherwise mint a
    // note that does not exist and put a ghost in the graph.
    expect(targets('See [[Real]]\n\n```mermaid\nA --> B[[Fake]]\n```\n')).toEqual(['Real'])
  })

  it('ignores one inside an inline span', () => {
    expect(targets('Write `[[Fake]]` to link to [[Real]].')).toEqual(['Real'])
  })

  it('handles tilde fences', () => {
    expect(targets('~~~\n[[Fake]]\n~~~\n[[Real]]\n')).toEqual(['Real'])
  })

  it('does not let a backtick inside a tilde fence close it', () => {
    expect(targets('~~~\n```\n[[Fake]]\n~~~\n[[Real]]\n')).toEqual(['Real'])
  })

  it('treats an unclosed fence as running to the end, as a renderer does', () => {
    expect(targets('[[Real]]\n\n```\n[[Fake]]\n')).toEqual(['Real'])
  })

  it('still finds links after a fence closes', () => {
    expect(targets('```\n[[Fake]]\n```\n\nThen [[Real]].')).toEqual(['Real'])
  })

  it('leaves ordinary links alone', () => {
    expect(targets('A [[One]] and a [[Two|alias]] and an ![[Three]].')).toEqual([
      'One',
      'Two',
      'Three'
    ])
  })
})
