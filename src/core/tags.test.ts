import { describe, expect, it } from 'vitest'
import { collectTags, findTags } from './tags'

const names = (text: string): string[] => findTags(text).map((t) => t.tag)

describe('findTags', () => {
  it('finds a plain tag and reports where it is', () => {
    const found = findTags('a #project note')
    expect(found).toEqual([{ tag: 'project', from: 2, to: 10 }])
  })

  it('accepts nesting, digits, dashes and underscores', () => {
    expect(names('#work/2026 #a-b #a_b #v2')).toEqual(['work/2026', 'a-b', 'a_b', 'v2'])
  })

  it('rejects a bare number, which is a heading anchor or an issue reference', () => {
    expect(names('#123 and #4.5')).toEqual([])
  })

  it('needs whitespace or a line start before the hash', () => {
    expect(names('a#nottag me#neither')).toEqual([])
    expect(names('#first\n#second')).toEqual(['first', 'second'])
  })

  it('is not fooled by a markdown heading', () => {
    expect(names('# Heading\n\n## Also heading')).toEqual([])
  })

  it('stops at punctuation', () => {
    expect(names('see #alpha, #beta. #gamma; done')).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('ignores tags inside inline code', () => {
    expect(names('use `#define` here but #real counts')).toEqual(['real'])
  })

  it('ignores tags inside a fenced code block', () => {
    const doc = ['before #one', '```', '#include <stdio.h>', '#also-not', '```', 'after #two'].join(
      '\n'
    )
    expect(names(doc)).toEqual(['one', 'two'])
  })

  it('ignores a URL fragment', () => {
    expect(names('see https://x.dev/page#section and #real')).toEqual(['real'])
  })

  it('finds the same tag twice when it appears twice', () => {
    expect(names('#dup and #dup')).toEqual(['dup', 'dup'])
  })
})

describe('collectTags', () => {
  it('counts tags across notes, most used first', () => {
    const index = collectTags([
      { path: '/v/a.md', content: '#project #rust' },
      { path: '/v/b.md', content: '#rust #rust again' }
    ])
    expect(index.map((t) => [t.tag, t.count])).toEqual([
      ['rust', 3],
      ['project', 1]
    ])
  })

  it('remembers which notes carry a tag, without duplicates', () => {
    const index = collectTags([{ path: '/v/b.md', content: '#rust #rust' }])
    expect(index[0]!.paths).toEqual(['/v/b.md'])
  })

  it('sorts alphabetically when counts tie', () => {
    const index = collectTags([{ path: '/v/a.md', content: '#zebra #apple' }])
    expect(index.map((t) => t.tag)).toEqual(['apple', 'zebra'])
  })

  it('has nothing to say about an empty vault', () => {
    expect(collectTags([])).toEqual([])
  })
})
