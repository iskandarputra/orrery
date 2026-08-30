import { describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import { isInside, loadedDirs, parentDir, withChildren } from './file-tree'

const dir = (path: string, children?: FileNode[]): FileNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'directory',
  ...(children ? { children } : {})
})
const file = (path: string): FileNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'file'
})

const tree = (): FileNode =>
  dir('/v', [dir('/v/notes', [dir('/v/notes/deep')]), dir('/v/other'), file('/v/Index.md')])

describe('withChildren', () => {
  it('fills in a directory that had not been read', () => {
    const next = withChildren(tree(), '/v/notes/deep', [file('/v/notes/deep/a.md')])
    const deep = next.children![0]!.children![0]!
    expect(deep.children).toHaveLength(1)
  })

  it('leaves the branches it did not touch identical', () => {
    // The renderer decides what to redraw by identity, so rebuilding a subtree
    // nobody changed is a repaint of everything under it.
    const before = tree()
    const next = withChildren(before, '/v/notes/deep', [])
    expect(next).not.toBe(before)
    expect(next.children![1]).toBe(before.children![1])
    expect(next.children![2]).toBe(before.children![2])
  })

  it('tells an empty directory from one nobody has opened', () => {
    const next = withChildren(tree(), '/v/other', [])
    expect(next.children![1]!.children).toEqual([])
    expect(tree().children![1]!.children).toBeUndefined()
  })

  it('returns the tree unchanged when the directory is not in it', () => {
    const before = tree()
    expect(withChildren(before, '/v/missing', [])).toBe(before)
  })

  it('can replace the root itself', () => {
    expect(withChildren(tree(), '/v', [file('/v/only.md')]).children).toHaveLength(1)
  })
})

describe('loadedDirs', () => {
  it('lists the directories that have been read and not the ones that have not', () => {
    expect(loadedDirs(tree())).toEqual(['/v', '/v/notes'])
  })

  it('has nothing to say about an unopened vault', () => {
    expect(loadedDirs(null)).toEqual([])
  })
})

describe('parentDir', () => {
  it('takes the directory a file sits in', () => {
    expect(parentDir('/v/notes/a.md')).toBe('/v/notes')
    expect(parentDir('C:\\v\\notes\\a.md')).toBe('C:\\v\\notes')
  })

  it('leaves a bare name alone rather than returning nothing', () => {
    expect(parentDir('a.md')).toBe('a.md')
  })
})

describe('isInside', () => {
  it('counts a directory as inside itself', () => {
    expect(isInside('/v/notes', '/v/notes')).toBe(true)
  })

  it('does not mistake a sibling with a longer name for a child', () => {
    // `/v/notes-old` starts with `/v/notes`, and treating it as a child would
    // send an expansion into the wrong branch.
    expect(isInside('/v/notes-old/a.md', '/v/notes')).toBe(false)
    expect(isInside('/v/notes/a.md', '/v/notes')).toBe(true)
  })
})
