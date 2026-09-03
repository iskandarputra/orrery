import { describe, expect, it } from 'vitest'
import { buildPathTree, type PathTreeNode } from './path-tree'

/** A stand-in for whatever a caller hangs off a leaf — a change, a commit file. */
interface Item {
  path: string
  tag: string
}

const items = (...paths: string[]): Item[] => paths.map((path) => ({ path, tag: `tag:${path}` }))
const tree = (...paths: string[]): PathTreeNode<Item>[] =>
  buildPathTree(items(...paths), (item) => item.path)

/** Names only, nested — the shape a reader of the panel would describe. */
const shape = (nodes: PathTreeNode<Item>[]): unknown =>
  nodes.map((node) => (node.kind === 'file' ? node.name : { [node.name]: shape(node.children) }))

describe('buildPathTree', () => {
  it('returns nothing for no files', () => {
    expect(tree()).toEqual([])
  })

  it('leaves a root-level file at the root', () => {
    expect(shape(tree('README.md'))).toEqual(['README.md'])
  })

  it('carries the original item on the leaf', () => {
    // The whole point of the generic: a row still needs its change to draw a
    // status letter and stage itself, and the tree must not strip that away.
    const dir = tree('src/a.ts')[0]!
    if (dir.kind !== 'directory') throw new Error('expected a directory at the root')
    expect(dir.children[0]).toMatchObject({
      kind: 'file',
      path: 'src/a.ts',
      item: { tag: 'tag:src/a.ts' }
    })
  })

  it('groups files under the directory they share', () => {
    expect(shape(tree('src/a.ts', 'src/b.ts'))).toEqual([{ src: ['a.ts', 'b.ts'] }])
  })

  it('compacts a chain of single-child directories into one row', () => {
    // What VS Code does, and the reason a deep tree stays readable in a narrow
    // panel: three rows that each hold only the next one say nothing on their own.
    expect(shape(tree('src/renderer/components/GitGraph.tsx'))).toEqual([
      { 'src/renderer/components': ['GitGraph.tsx'] }
    ])
  })

  it('stops compacting where a directory branches', () => {
    expect(shape(tree('src/a/one.ts', 'src/b/two.ts'))).toEqual([
      { src: [{ a: ['one.ts'] }, { b: ['two.ts'] }] }
    ])
  })

  it('does not compact a directory that also holds a file', () => {
    expect(shape(tree('src/a.ts', 'src/sub/b.ts'))).toEqual([{ src: [{ sub: ['b.ts'] }, 'a.ts'] }])
  })

  it('puts directories before files and sorts each alphabetically', () => {
    expect(shape(tree('z.md', 'a.md', 'zed/f.ts', 'alpha/f.ts'))).toEqual([
      { alpha: ['f.ts'] },
      { zed: ['f.ts'] },
      'a.md',
      'z.md'
    ])
  })

  it('gives a compacted directory the full path of its deepest segment', () => {
    const dir = tree('src/core/a.ts')[0]!
    expect(dir).toMatchObject({ kind: 'directory', name: 'src/core', path: 'src/core' })
  })
})
