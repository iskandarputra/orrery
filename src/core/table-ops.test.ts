import { describe, expect, it } from 'vitest'
import {
  columnWidths,
  compareCells,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  viewOrder
} from './table-ops'

const table = [
  ['name', 'qty', 'note'],
  ['pears', '10', 'ripe'],
  ['apples', '9', ''],
  ['figs', '100', 'soft']
]

describe('compareCells', () => {
  it('sorts numbers as numbers', () => {
    // The whole reason a spreadsheet sorts differently from a text editor.
    expect(compareCells('9', '10')).toBeLessThan(0)
    expect(compareCells('100', '9')).toBeGreaterThan(0)
  })

  it('reads a number with thousands separators', () => {
    expect(compareCells('1,200', '900')).toBeGreaterThan(0)
  })

  it('sorts text as text, ignoring case', () => {
    expect(compareCells('apple', 'Banana')).toBeLessThan(0)
  })

  it('puts numbers inside names in human order', () => {
    expect(compareCells('file2', 'file10')).toBeLessThan(0)
  })

  it('sends empty cells to the end, whichever way it is sorted', () => {
    // "No value" is not a value that belongs at the top.
    expect(compareCells('', 'a')).toBeGreaterThan(0)
    expect(compareCells('a', '')).toBeLessThan(0)
    expect(compareCells('', '')).toBe(0)
  })

  it('does not read a European decimal as a thousands separator', () => {
    // `1,2` is one point two somewhere, and text here rather than 12.
    expect(compareCells('1,2', '1,3')).toBeLessThan(0)
  })
})

describe('viewOrder', () => {
  it('is the file’s own order when nothing is asked of it', () => {
    expect(viewOrder(table).order).toEqual([1, 2, 3])
  })

  it('sorts the body and never the header', () => {
    const { order } = viewOrder(table, { sortColumn: 1, direction: 'asc' })
    expect(order).toEqual([2, 1, 3])
    expect(order).not.toContain(0)
  })

  it('sorts the other way round', () => {
    expect(viewOrder(table, { sortColumn: 1, direction: 'desc' }).order).toEqual([3, 1, 2])
  })

  it('keeps equal rows in the order the file has them', () => {
    const ties = [
      ['a', 'b'],
      ['x', '1'],
      ['y', '1'],
      ['z', '1']
    ]
    expect(viewOrder(ties, { sortColumn: 1 }).order).toEqual([1, 2, 3])
  })

  it('filters on any cell in the row, and says how many it hid', () => {
    const { order, hidden } = viewOrder(table, { filter: 'ripe' })
    expect(order).toEqual([1])
    expect(hidden).toBe(2)
  })

  it('filters without caring about case', () => {
    expect(viewOrder(table, { filter: 'APPLES' }).order).toEqual([2])
  })

  it('filters and sorts together', () => {
    const wide = [...table, ['pear tart', '2', 'ripe']]
    expect(viewOrder(wide, { filter: 'ripe', sortColumn: 1, direction: 'asc' }).order).toEqual([
      4, 1
    ])
  })

  it('has an empty order for a table with only a header', () => {
    expect(viewOrder([['a', 'b']])).toEqual({ order: [], hidden: 0 })
  })
})

describe('moving', () => {
  it('moves a column with its header and every cell', () => {
    expect(moveColumn(table, 0, 2)).toEqual([
      ['qty', 'note', 'name'],
      ['10', 'ripe', 'pears'],
      ['9', '', 'apples'],
      ['100', 'soft', 'figs']
    ])
  })

  it('moves a column left as well as right', () => {
    expect(moveColumn(table, 2, 0)[0]).toEqual(['note', 'name', 'qty'])
  })

  it('pads a short row rather than losing its cells', () => {
    const ragged = [['a', 'b', 'c'], ['x']]
    expect(moveColumn(ragged, 0, 2)).toEqual([
      ['b', 'c', 'a'],
      ['', '', 'x']
    ])
  })

  it('moves a body row', () => {
    expect(moveRow(table, 3, 1).map((row) => row[0])).toEqual(['name', 'figs', 'pears', 'apples'])
  })

  it('will not move the header, or move a row on top of it', () => {
    expect(moveRow(table, 0, 2)).toEqual(table)
    expect(moveRow(table, 2, 0)).toEqual(table)
  })

  it('ignores a move that goes nowhere or off the end', () => {
    expect(moveColumn(table, 1, 1)).toEqual(table)
    expect(moveColumn(table, 0, 9)).toEqual(table)
    expect(moveRow(table, 1, 9)).toEqual(table)
  })
})

describe('inserting and deleting', () => {
  it('inserts a row where it was asked for', () => {
    expect(insertRow(table, 2, 3)[2]).toEqual(['', '', ''])
    expect(insertRow(table, 2, 3)).toHaveLength(5)
  })

  it('never inserts a row above the header', () => {
    expect(insertRow(table, 0, 3)[0]).toEqual(['name', 'qty', 'note'])
  })

  it('inserts a column in the header and every row', () => {
    const wider = insertColumn(table, 1, 3)
    expect(wider[0]).toEqual(['name', '', 'qty', 'note'])
    expect(wider[1]).toEqual(['pears', '', '10', 'ripe'])
  })

  it('deletes a row and a column', () => {
    expect(deleteRow(table, 1).map((row) => row[0])).toEqual(['name', 'apples', 'figs'])
    expect(deleteColumn(table, 1, 3)[0]).toEqual(['name', 'note'])
  })

  it('refuses to delete the header row', () => {
    expect(deleteRow(table, 0)).toEqual(table)
  })

  it('ignores a column that is not there', () => {
    expect(deleteColumn(table, 9, 3)).toEqual(table)
  })
})

describe('columnWidths', () => {
  it('gives a wider column to longer content', () => {
    const widths = columnWidths([
      ['short', 'a much longer column of text here'],
      ['x', 'y']
    ])
    expect(widths[1]).toBeGreaterThan(widths[0]!)
  })

  it('keeps every column between the bounds', () => {
    const widths = columnWidths([['', 'x'.repeat(500)]])
    expect(widths[0]).toBe(80)
    expect(widths[1]).toBe(340)
  })
})
