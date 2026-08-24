import { describe, expect, it } from 'vitest'
import { unwrapParagraphs } from './reflow'

describe('unwrapParagraphs', () => {
  it('joins hard-wrapped paragraph lines', () => {
    expect(unwrapParagraphs('one two\nthree four\nfive')).toBe('one two three four five')
  })

  it('keeps paragraph boundaries (blank lines)', () => {
    expect(unwrapParagraphs('a\nb\n\nc\nd')).toBe('a b\n\nc d')
  })

  it('never merges structure: headings, lists, quotes, tables', () => {
    const doc = '# Title\ntext\n- item one\n- item two\n> quote\n| a | b |'
    expect(unwrapParagraphs(doc)).toBe(doc)
  })

  it('leaves fenced code untouched', () => {
    const doc = '```\nline1\nline2\n```'
    expect(unwrapParagraphs(doc)).toBe(doc)
  })

  it('respects two-space hard breaks', () => {
    expect(unwrapParagraphs('line one  \nline two')).toBe('line one  \nline two')
  })

  it('unwraps paragraphs containing inline code spans and parentheses', () => {
    const input = '`log_filters.is_case_sensitive` exists as a column\n(`app/models.py`), has a default\n(`logs.py:31`).'
    const expected = '`log_filters.is_case_sensitive` exists as a column (`app/models.py`), has a default (`logs.py:31`).'
    expect(unwrapParagraphs(input)).toBe(expected)
  })
})
