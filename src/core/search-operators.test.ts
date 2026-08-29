import { describe, expect, it } from 'vitest'
import { operatorGlob, parseSearchQuery, tokenize } from './search-operators'

const parse = (input: string, regex = false): ReturnType<typeof parseSearchQuery> =>
  parseSearchQuery(input, regex)

describe('tokenize', () => {
  it('splits on spaces', () => {
    expect(tokenize('a b c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a quoted phrase together', () => {
    // Otherwise a phrase becomes several terms that must each appear, which is
    // a different question from the one being asked.
    expect(tokenize('"exact phrase" other')).toEqual(['exact phrase', 'other'])
  })

  it('ignores runs of spaces and an unclosed quote', () => {
    expect(tokenize('  a   b  ')).toEqual(['a', 'b'])
    expect(tokenize('"never closed')).toEqual(['never closed'])
  })
})

describe('operatorGlob', () => {
  it('reads path: as a directory', () => {
    expect(operatorGlob('path', 'src')).toBe('src/**')
    expect(operatorGlob('path', 'src/')).toBe('src/**')
  })

  it('reads file: as part of a name, anywhere', () => {
    // `file:test` is asking for files with "test" in the name.
    expect(operatorGlob('file', 'test')).toBe('*test*')
  })

  it('passes an explicit glob through, because they said what they meant', () => {
    expect(operatorGlob('file', '*.ts')).toBe('*.ts')
    expect(operatorGlob('path', 'src/**/fixtures')).toBe('src/**/fixtures')
  })
})

describe('operators become include and exclude', () => {
  it('turns path: and file: into includes', () => {
    const parsed = parse('needle path:src file:*.ts')
    expect(parsed.include).toBe('src/**, *.ts')
    expect(parsed.query).toBe('needle')
  })

  it('turns a leading minus into an exclude', () => {
    const parsed = parse('needle -path:dist -file:*.lock')
    expect(parsed.exclude).toBe('dist/**, *.lock')
    expect(parsed.include).toBe('')
  })

  it('turns tag: into the text a tag actually is', () => {
    expect(parse('tag:draft').query).toBe('#draft')
    expect(parse('tag:#draft').query).toBe('#draft')
  })

  it('leaves an operator with no argument as ordinary text', () => {
    // Mid-typing, `path:` is not yet a filter; treating it as one would empty
    // the results on the way to something useful.
    expect(parse('path:').query).toBe('path:')
  })
})

describe('several terms mean a line with all of them', () => {
  it('combines with lookaheads, in any order', () => {
    const parsed = parse('alpha beta')
    expect(parsed.regex).toBe(true)
    expect(parsed.query).toBe('(?=.*alpha)(?=.*beta).*')
    expect(new RegExp(parsed.query).test('beta then alpha')).toBe(true)
    expect(new RegExp(parsed.query).test('alpha only')).toBe(false)
  })

  it('escapes the terms when the user is not writing a regex', () => {
    expect(new RegExp(parse('a.c b').query).test('a.c and b')).toBe(true)
    expect(new RegExp(parse('a.c b').query).test('axc and b')).toBe(false)
  })

  it('does not escape them when the user is', () => {
    expect(new RegExp(parse('\\d+ b', true).query).test('42 and b')).toBe(true)
  })

  it('leaves a single term alone, so a literal search stays literal', () => {
    const parsed = parse('needle')
    expect(parsed.query).toBe('needle')
    expect(parsed.regex).toBe(false)
  })

  it('keeps the user regex flag for a single term', () => {
    expect(parse('\\d+', true)).toMatchObject({ query: '\\d+', regex: true })
  })

  it('treats a tag as one of the terms', () => {
    const parsed = parse('tag:draft budget')
    expect(new RegExp(parsed.query).test('the #draft budget line')).toBe(true)
    expect(new RegExp(parsed.query).test('the budget line')).toBe(false)
  })
})

describe('a query of only operators', () => {
  it('filters without searching for anything in particular', () => {
    // `path:src` alone means "show me what is in src", which the caller turns
    // into an empty query rather than a search for the literal text.
    expect(parse('path:src')).toMatchObject({ query: '', include: 'src/**' })
  })

  it('handles an empty box', () => {
    expect(parse('')).toMatchObject({ query: '', include: '', exclude: '', terms: [] })
  })
})
