import { describe, expect, it } from 'vitest'
import { buildSearchMatcher, escapeRegex, searchPattern, type SearchOptions } from './search-query'

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...over
})

const hits = (line: string, query: string, over: Partial<SearchOptions> = {}): boolean => {
  const matcher = buildSearchMatcher(query, opts(over))
  return matcher ? matcher.test(line) : false
}

describe('literal queries', () => {
  it('means itself, metacharacters included', () => {
    expect(hits('a.b', 'a.b')).toBe(true)
    expect(hits('axb', 'a.b')).toBe(false)
  })

  it('escapes every metacharacter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o'
    )
  })
})

describe('case sensitivity', () => {
  it('ignores case by default', () => {
    expect(hits('Hello', 'hello')).toBe(true)
  })

  it('respects it when asked', () => {
    expect(hits('Hello', 'hello', { caseSensitive: true })).toBe(false)
    expect(hits('Hello', 'Hello', { caseSensitive: true })).toBe(true)
  })
})

describe('whole word', () => {
  it('does not match inside a longer word', () => {
    expect(hits('testing', 'test')).toBe(true)
    expect(hits('testing', 'test', { wholeWord: true })).toBe(false)
  })

  it('matches the word on its own', () => {
    expect(hits('a test here', 'test', { wholeWord: true })).toBe(true)
  })

  it('bounds the whole pattern, not each alternative', () => {
    // `\b(?:a|b)\b`, not `\ba|b\b` — the second would leave `b` unbounded and
    // quietly match inside a word.
    expect(searchPattern('a|b', opts({ regex: true, wholeWord: true }))).toBe('\\b(?:a|b)\\b')
    expect(hits('cab', 'a|b', { regex: true, wholeWord: true })).toBe(false)
  })
})

describe('regex queries', () => {
  it('is used as written', () => {
    expect(hits('foo123', '\\d+', { regex: true })).toBe(true)
  })

  it('reports no matcher for a half-typed pattern rather than throwing', () => {
    // `[` on the way to `[a-z]`: nobody wants an error dialog per keystroke.
    expect(buildSearchMatcher('[', opts({ regex: true }))).toBeNull()
  })

  it('reports no matcher for an empty query', () => {
    expect(buildSearchMatcher('', opts())).toBeNull()
  })
})
