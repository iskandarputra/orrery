import { describe, expect, it } from 'vitest'
import {
  emptyFrontmatter,
  parseFrontmatter,
  removeProperty,
  renameProperty,
  replaceFrontmatter,
  serializeFrontmatter,
  setProperty,
  unquote
} from './frontmatter'

const NOTE = [
  '---',
  'title: Orbital mechanics',
  'tags:',
  '  - research',
  '  - draft',
  'status: in-progress',
  'aliases: [orbits, kepler]',
  '---',
  '',
  '# Orbital mechanics',
  ''
].join('\n')

const parsed = () => parseFrontmatter(NOTE)!

describe('parsing', () => {
  it('reads scalars, block lists and inline lists', () => {
    expect(parsed().properties.map((p) => [p.key, p.value])).toEqual([
      ['title', 'Orbital mechanics'],
      ['tags', ['research', 'draft']],
      ['status', 'in-progress'],
      ['aliases', ['orbits', 'kepler']]
    ])
  })

  it('reports where the block ends, so the body can be kept', () => {
    expect(NOTE.slice(parsed().end)).toBe('\n# Orbital mechanics\n')
  })

  it('returns null when the note has no block', () => {
    expect(parseFrontmatter('# Just a note\n')).toBeNull()
  })

  it('returns null for a rule that is not at the very top', () => {
    // A horizontal rule further down is not frontmatter, and reading it as one
    // would swallow the prose above it.
    expect(parseFrontmatter('# Title\n\n---\n\nBody\n')).toBeNull()
  })

  it('returns null for a block that is never closed', () => {
    expect(parseFrontmatter('---\ntitle: x\n\n# Body\n')).toBeNull()
  })

  it('strips one layer of quotes and no more', () => {
    expect(unquote('"quoted"')).toBe('quoted')
    expect(unquote("'quoted'")).toBe('quoted')
    expect(unquote('""double""')).toBe('"double"')
    expect(unquote('unquoted')).toBe('unquoted')
  })

  it('reads an empty list', () => {
    expect(parseFrontmatter('---\ntags: []\n---\n')!.properties[0]!.value).toEqual([])
  })
})

describe('round-tripping, which is the hard requirement', () => {
  it('writes an untouched block back byte for byte', () => {
    expect(replaceFrontmatter(NOTE, parsed())).toBe(NOTE)
  })

  it('leaves every other property alone when one changes', () => {
    // The whole point: editing a tag must not requote, respace or reorder the
    // rest, or every note churns the first time it is opened.
    const next = replaceFrontmatter(NOTE, setProperty(parsed(), 'status', 'done'))
    expect(next).toContain('aliases: [orbits, kepler]')
    expect(next).toContain('  - research')
    expect(next).toContain('title: Orbital mechanics')
    expect(next).toContain('status: done')
    expect(next).not.toContain('in-progress')
  })

  it('keeps unusual formatting that it did not write', () => {
    const odd = "---\nkey:    lots   of   space\nother: 'single quoted'\n---\nBody\n"
    expect(replaceFrontmatter(odd, parseFrontmatter(odd)!)).toBe(odd)
  })

  it('keeps the body exactly, including its blank lines', () => {
    const body = '\n\n# Title\n\n\nParagraph.\n'
    const doc = `---\na: 1\n---${body}`
    expect(replaceFrontmatter(doc, parseFrontmatter(doc)!)).toBe(doc)
  })

  it('round-trips CRLF without converting it', () => {
    const crlf = '---\r\na: 1\r\n---\r\nBody\r\n'
    expect(replaceFrontmatter(crlf, parseFrontmatter(crlf)!)).toBe(crlf)
  })
})

describe('editing', () => {
  it('adds a property at the end', () => {
    const next = setProperty(parsed(), 'due', '2026-09-14')
    expect(next.properties.at(-1)).toMatchObject({ key: 'due', value: '2026-09-14' })
    expect(replaceFrontmatter(NOTE, next)).toContain('due: 2026-09-14')
  })

  it('writes a list as block items', () => {
    const next = setProperty(parsed(), 'tags', ['one', 'two'])
    expect(replaceFrontmatter(NOTE, next)).toContain('tags:\n  - one\n  - two')
  })

  it('writes an empty list inline, since block form would be nothing at all', () => {
    expect(serializeFrontmatter(setProperty(emptyFrontmatter(), 'tags', []))).toContain('tags: []')
  })

  it('removes a property and its list items together', () => {
    const next = replaceFrontmatter(NOTE, removeProperty(parsed(), 'tags'))
    expect(next).not.toContain('research')
    expect(next).toContain('title: Orbital mechanics')
  })

  it('renames a key without moving it', () => {
    const next = renameProperty(parsed(), 'status', 'state')
    expect(next.properties.map((p) => p.key)).toEqual(['title', 'tags', 'state', 'aliases'])
  })

  it('quotes a value that YAML would otherwise misread', () => {
    const quoted = (value: string): string =>
      serializeFrontmatter(setProperty(emptyFrontmatter(), 'k', value))
    expect(quoted('plain')).toContain('k: plain')
    expect(quoted('')).toContain('k: ""')
    expect(quoted(' padded ')).toContain('k: " padded "')
    expect(quoted('- looks like a list')).toContain('k: "- looks like a list"')
    expect(quoted('has: colon space')).toContain('k: "has: colon space"')
  })

  it('adds a block to a note that had none', () => {
    const added = setProperty(emptyFrontmatter(), 'title', 'New')
    expect(replaceFrontmatter('# Body\n', added)).toBe('---\ntitle: New\n---\n# Body\n')
  })
})
