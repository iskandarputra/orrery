import { describe, expect, it } from 'vitest'
import { displayWidth, formatTable, parseTable, splitRow } from './markdown-table'

describe('splitRow', () => {
  it('splits cells and trims outer pipes/whitespace', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c'])
    expect(splitRow('a | b')).toEqual(['a', 'b'])
  })

  it('honors escaped pipes', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })
})

describe('parseTable', () => {
  it('parses header, alignment and rows', () => {
    const table = parseTable('| Name | Score |\n| :--- | ---: |\n| a | 1 |\n| b | 2 |')
    expect(table).toEqual({
      header: ['Name', 'Score'],
      align: ['left', 'right'],
      rows: [
        ['a', '1'],
        ['b', '2']
      ]
    })
  })

  it('normalizes short rows to header width and centers with :---:', () => {
    const table = parseTable('| a | b | c |\n| :-: | --- | --- |\n| only |')
    expect(table?.align[0]).toBe('center')
    expect(table?.rows[0]).toEqual(['only', '', ''])
  })

  it('rejects non-tables', () => {
    expect(parseTable('| a |\n| not delim |')).toBeNull()
    expect(parseTable('just text')).toBeNull()
  })
})

describe('displayWidth', () => {
  it('counts ordinary text by its characters', () => {
    expect(displayWidth('hello')).toBe(5)
  })

  it('counts a CJK character as the two columns it occupies', () => {
    // Counting UTF-16 units would pad a Japanese table into a mess.
    expect(displayWidth('日本語')).toBe(6)
    expect(displayWidth('한국어')).toBe(6)
  })

  it('counts an emoji as two, and its modifiers as none', () => {
    expect(displayWidth('🙂')).toBe(2)
    expect(displayWidth('👍🏽')).toBe(4)
  })

  it('ignores combining marks, which sit on the character before', () => {
    expect(displayWidth('é')).toBe(1)
  })
})

describe('formatTable', () => {
  it('lines the pipes up', () => {
    const source = ['|name|qty|', '|-|-|', '|pears|10|', '|a very long name|1|'].join('\n')
    expect(formatTable(source)).toBe(
      [
        '| name             | qty |',
        '| ---------------- | --- |',
        '| pears            | 10  |',
        '| a very long name | 1   |'
      ].join('\n')
    )
  })

  it('keeps the alignment each column declared', () => {
    // Reformatting must not quietly re-align somebody's columns.
    const source = ['| a | b | c |', '| :- | :-: | -: |', '| 1 | 2 | 3 |'].join('\n')
    const out = formatTable(source)!.split('\n')
    expect(out[1]).toBe('| :-- | :-: | --: |')
    // And the cells are padded the way their column is aligned.
    expect(out[2]).toBe('| 1   |  2  |   3 |')
  })

  it('pads a ragged row out to the header', () => {
    const source = ['| a | b |', '| - | - |', '| 1 |'].join('\n')
    expect(formatTable(source)!.split('\n')[2]).toBe('| 1   |     |')
  })

  it('keeps an escaped pipe escaped', () => {
    const source = ['| a | b |', '| - | - |', '| x \\| y | 2 |'].join('\n')
    const out = formatTable(source)!
    expect(out).toContain('x \\| y')
    // Still a two-column table when read back.
    expect(parseTable(out)!.rows[0]).toEqual(['x | y', '2'])
  })

  it('measures a CJK cell by what it occupies on screen', () => {
    const source = ['| name | note |', '| - | - |', '| 日本語 | ok |'].join('\n')
    const lines = formatTable(source)!.split('\n')
    // Every line ends in the same column, which is the whole point.
    expect(new Set(lines.map((line) => displayWidth(line))).size).toBe(1)
  })

  it('round-trips: formatting an aligned table changes nothing', () => {
    const source = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const once = formatTable(source)!
    expect(formatTable(once)).toBe(once)
  })

  it('has nothing to say about text that is not a table', () => {
    expect(formatTable('just a paragraph')).toBeNull()
    expect(formatTable('| a |')).toBeNull()
  })

  it('never writes a delimiter too short to parse', () => {
    const source = ['| a |', '| - |', '| 1 |'].join('\n')
    const out = formatTable(source)!
    expect(parseTable(out)).not.toBeNull()
    expect(out.split('\n')[1]).toBe('| --- |')
  })
})
