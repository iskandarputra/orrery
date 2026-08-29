import { describe, expect, it } from 'vitest'
import { columnCount, detectDelimiter, formatCsv, formatField, padRow, parseCsv } from './csv'

const rows = (text: string): string[][] => parseCsv(text).rows

describe('parsing the easy case', () => {
  it('reads plain rows and fields', () => {
    expect(rows('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('ends the last row on a trailing newline rather than adding a blank one', () => {
    // A reader that appends an empty row on every save corrupts the file a
    // little more each time it is opened.
    expect(rows('a,b\n')).toEqual([['a', 'b']])
    expect(rows('a,b')).toEqual([['a', 'b']])
  })

  it('keeps empty fields', () => {
    expect(rows('a,,c\n')).toEqual([['a', '', 'c']])
    expect(rows(',,\n')).toEqual([['', '', '']])
  })

  it('reads an empty file as no rows', () => {
    expect(rows('')).toEqual([])
  })
})

describe('quoting, which is where splitting on commas fails', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(rows('"Smith, John",42\n')).toEqual([['Smith, John', '42']])
  })

  it('keeps a newline inside a quoted field', () => {
    expect(rows('"line one\nline two",b\n')).toEqual([['line one\nline two', 'b']])
  })

  it('reads a doubled quote as one literal quote', () => {
    expect(rows('"say ""hi""",b\n')).toEqual([['say "hi"', 'b']])
  })

  it('handles a field that is only quotes', () => {
    expect(rows('"""",b\n')).toEqual([['"', 'b']])
  })

  it('treats a quote in the middle of a bare field as text', () => {
    // `a"b` is not a quoted field; only a quote at the start opens one.
    expect(rows('a"b,c\n')).toEqual([['a"b', 'c']])
  })
})

describe('line endings', () => {
  it('reads CRLF as one row break', () => {
    expect(rows('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('remembers which ending the file used', () => {
    expect(parseCsv('a\r\nb\r\n').eol).toBe('\r\n')
    expect(parseCsv('a\nb\n').eol).toBe('\n')
  })
})

describe('delimiters', () => {
  it('detects a semicolon file', () => {
    // A European spreadsheet export, which read as commas would be one column.
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(rows('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('detects tabs', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
  })

  it('ignores delimiters inside quotes when guessing', () => {
    expect(detectDelimiter('"a;b;c;d",x')).toBe(',')
  })

  it('falls back to a comma when there is nothing to go on', () => {
    expect(detectDelimiter('single')).toBe(',')
  })
})

describe('writing', () => {
  it('quotes only what has to be quoted', () => {
    expect(formatField('plain')).toBe('plain')
    expect(formatField('has,comma')).toBe('"has,comma"')
    expect(formatField('has"quote')).toBe('"has""quote"')
    expect(formatField('has\nnewline')).toBe('"has\nnewline"')
    // Leading or trailing space survives only inside quotes.
    expect(formatField(' padded ')).toBe('" padded "')
  })

  it('round-trips a file unchanged', () => {
    const original = '"Smith, John",42\n"say ""hi""","line one\nline two"\n'
    expect(formatCsv(parseCsv(original))).toBe(original)
  })

  it('round-trips a semicolon file with its delimiter', () => {
    const original = 'a;b\n1;2\n'
    expect(formatCsv(parseCsv(original))).toBe(original)
  })

  it('round-trips CRLF', () => {
    expect(formatCsv(parseCsv('a,b\r\n1,2\r\n'))).toBe('a,b\r\n1,2\r\n')
  })

  it('writes an empty table as an empty file', () => {
    expect(formatCsv({ rows: [], delimiter: ',', eol: '\n' })).toBe('')
  })
})

describe('shape', () => {
  it('reports the widest row', () => {
    expect(columnCount([['a'], ['a', 'b', 'c'], ['a', 'b']])).toBe(3)
    expect(columnCount([])).toBe(0)
  })

  it('pads a short row without touching a long one', () => {
    expect(padRow(['a'], 3)).toEqual(['a', '', ''])
    expect(padRow(['a', 'b', 'c'], 2)).toEqual(['a', 'b', 'c'])
  })
})
