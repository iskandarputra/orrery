import { describe, expect, it } from 'vitest'
import { matchSlashQuery, slashItems, filterSlashItems } from './slash-menu'

describe('matchSlashQuery', () => {
  it('triggers on a slash at the start of a line', () => {
    expect(matchSlashQuery('/', 1)).toEqual({ from: 0, query: '' })
    expect(matchSlashQuery('/tab', 4)).toEqual({ from: 0, query: 'tab' })
  })

  it('triggers after whitespace', () => {
    expect(matchSlashQuery('some text /co', 13)).toEqual({ from: 10, query: 'co' })
  })

  it('leaves ordinary prose alone', () => {
    // The cases that would make a slash menu infuriating.
    expect(matchSlashQuery('and/or', 6)).toBeNull()
    expect(matchSlashQuery('https://example.com', 19)).toBeNull()
    expect(matchSlashQuery('a path/to/file', 14)).toBeNull()
    expect(matchSlashQuery('24/7', 4)).toBeNull()
  })

  it('stops once the query stops looking like a command', () => {
    expect(matchSlashQuery('/code block', 11)).toBeNull() // a space ends it
    expect(matchSlashQuery('/', 0)).toBeNull() // cursor before the slash
  })
})

describe('slashItems', () => {
  it('offers the block types the editor can render', () => {
    const labels = slashItems().map((i) => i.label.toLowerCase())
    for (const expected of ['table', 'code', 'callout', 'quote', 'divider', 'task']) {
      expect(labels.some((l) => l.includes(expected))).toBe(true)
    }
  })

  it('gives every item a distinct label and something to insert', () => {
    const items = slashItems()
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length)
    for (const item of items) expect(item.run).toBeTypeOf('function')
  })
})

describe('filterSlashItems', () => {
  const items = slashItems()

  it('matches on the label', () => {
    expect(filterSlashItems(items, 'tab').map((i) => i.label)).toContain('Table')
  })

  it('matches on a keyword the label does not contain', () => {
    // Someone typing "/todo" means the task list.
    const hit = filterSlashItems(items, 'todo').map((i) => i.label.toLowerCase())
    expect(hit.some((l) => l.includes('task'))).toBe(true)
  })

  it('is case-insensitive and returns everything for an empty query', () => {
    expect(filterSlashItems(items, 'TABLE').map((i) => i.label)).toContain('Table')
    expect(filterSlashItems(items, '')).toHaveLength(items.length)
  })

  it('returns nothing rather than everything for nonsense', () => {
    expect(filterSlashItems(items, 'zzzznotathing')).toEqual([])
  })
})
