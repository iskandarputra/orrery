import { describe, expect, it } from 'vitest'
import { parseTable, splitRow } from './markdown-table'

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
