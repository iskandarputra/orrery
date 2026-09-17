import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  clickSelect,
  findRow,
  moveSelect,
  parentRow,
  stepFocus,
  topmostSelected,
  visiblePaths,
  type TreeShape
} from './tree-selection'

const tree: TreeShape = {
  path: '/v',
  kind: 'directory',
  children: [
    {
      path: '/v/a',
      kind: 'directory',
      children: [
        { path: '/v/a/one.md', kind: 'file' },
        { path: '/v/a/two.md', kind: 'file' }
      ]
    },
    { path: '/v/b', kind: 'directory', children: [{ path: '/v/b/hidden.md', kind: 'file' }] },
    { path: '/v/top.md', kind: 'file' }
  ]
}
const open = new Set(['/v/a'])
const order = visiblePaths(tree, (p) => open.has(p))

describe('visiblePaths', () => {
  it('lists the rows as drawn, walking into open folders only', () => {
    expect(order).toEqual(['/v/a', '/v/a/one.md', '/v/a/two.md', '/v/b', '/v/top.md'])
  })

  it('treats a folder not read yet as having nothing to show', () => {
    const unread: TreeShape = {
      path: '/v',
      kind: 'directory',
      children: [{ path: '/v/c', kind: 'directory' }]
    }
    expect(visiblePaths(unread, () => true)).toEqual(['/v/c'])
  })
})

describe('clickSelect', () => {
  it('a plain click selects only that row, and anchors there', () => {
    const s = clickSelect(
      { paths: ['/v/b'], anchor: '/v/b', focus: '/v/b' },
      '/v/top.md',
      { toggle: false, range: false },
      order
    )
    expect(s).toEqual({ paths: ['/v/top.md'], anchor: '/v/top.md', focus: '/v/top.md' })
  })

  it('Ctrl adds a row, and takes it away again', () => {
    let s = clickSelect(EMPTY_SELECTION, '/v/a/one.md', { toggle: false, range: false }, order)
    s = clickSelect(s, '/v/top.md', { toggle: true, range: false }, order)
    expect(s.paths).toEqual(['/v/a/one.md', '/v/top.md'])
    s = clickSelect(s, '/v/a/one.md', { toggle: true, range: false }, order)
    expect(s.paths).toEqual(['/v/top.md'])
  })

  it('Shift takes the run from the anchor, in either direction, and keeps the anchor', () => {
    let s = clickSelect(EMPTY_SELECTION, '/v/a/one.md', { toggle: false, range: false }, order)
    s = clickSelect(s, '/v/b', { toggle: false, range: true }, order)
    expect(s.paths).toEqual(['/v/a/one.md', '/v/a/two.md', '/v/b'])
    expect(s.anchor).toBe('/v/a/one.md')
    // Back past the anchor: the run turns round rather than growing.
    s = clickSelect(s, '/v/a', { toggle: false, range: true }, order)
    expect(s.paths).toEqual(['/v/a', '/v/a/one.md'])
  })

  it('Shift with nothing chosen yet selects just that row', () => {
    const s = clickSelect(EMPTY_SELECTION, '/v/b', { toggle: false, range: true }, order)
    expect(s.paths).toEqual(['/v/b'])
  })
})

describe('stepFocus', () => {
  it('moves one row, and stops at either end', () => {
    expect(stepFocus(order, '/v/a/one.md', 1)).toBe('/v/a/two.md')
    expect(stepFocus(order, '/v/a/one.md', -1)).toBe('/v/a')
    expect(stepFocus(order, '/v/top.md', 1)).toBeNull()
    expect(stepFocus(order, '/v/a', -1)).toBeNull()
  })

  it('starts at the top going down and the bottom going up', () => {
    expect(stepFocus(order, null, 1)).toBe('/v/a')
    expect(stepFocus(order, null, -1)).toBe('/v/top.md')
    // A focused row that has since gone counts as none.
    expect(stepFocus(order, '/v/gone.md', 1)).toBe('/v/a')
  })

  it('has nowhere to go in an empty tree', () => {
    expect(stepFocus([], null, 1)).toBeNull()
  })
})

describe('moveSelect', () => {
  it('selects the row moved to, or extends to it with Shift', () => {
    const start = clickSelect(
      EMPTY_SELECTION,
      '/v/a/one.md',
      { toggle: false, range: false },
      order
    )
    expect(moveSelect(start, '/v/a/two.md', false, order).paths).toEqual(['/v/a/two.md'])
    expect(moveSelect(start, '/v/a/two.md', true, order).paths).toEqual([
      '/v/a/one.md',
      '/v/a/two.md'
    ])
  })
})

describe('parentRow', () => {
  it('is the folder a row sits in, when that folder is drawn', () => {
    expect(parentRow(order, '/v/a/two.md')).toBe('/v/a')
  })

  it('is nothing at the top level, where the vault has no row', () => {
    expect(parentRow(order, '/v/top.md')).toBeNull()
    expect(parentRow(order, '/v/a')).toBeNull()
  })
})

describe('topmostSelected', () => {
  it('drops a row inside another selected folder, and rows no longer drawn', () => {
    expect(topmostSelected(['/v/a/one.md', '/v/a', '/v/top.md', '/v/gone.md'], order)).toEqual([
      '/v/a',
      '/v/top.md'
    ])
  })

  it('keeps a sibling that only shares a prefix', () => {
    const o = ['/v/notes', '/v/notes-archive']
    expect(topmostSelected(['/v/notes', '/v/notes-archive'], o)).toEqual([
      '/v/notes',
      '/v/notes-archive'
    ])
  })
})

describe('findRow', () => {
  it('finds a node at any depth, and nothing for a path not read', () => {
    expect(findRow(tree, '/v/a/two.md')?.kind).toBe('file')
    expect(findRow(tree, '/v/b')?.kind).toBe('directory')
    expect(findRow(tree, '/v/nowhere.md')).toBeNull()
  })
})
