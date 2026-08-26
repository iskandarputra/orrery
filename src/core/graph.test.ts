import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph'

const files = [
  { path: '/v/A.md', stem: 'A', content: 'links [[B]] and [[Ghost]] and [[B]] again' },
  { path: '/v/B.md', stem: 'B', content: 'back to [[a]]' },
  { path: '/v/C.md', stem: 'C', content: 'lonely' }
]

describe('buildGraph', () => {
  it('creates nodes for all notes plus ghosts, deduplicates edges', () => {
    const g = buildGraph(files)
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['A', 'B', 'C', 'Ghost'])
    expect(g.edges).toHaveLength(3) // A→B (once), A→Ghost, B→A (case-insensitive)
    expect(g.nodes.find((n) => n.label === 'Ghost')?.exists).toBe(false)
  })

  it('computes degrees and ignores self-links', () => {
    const g = buildGraph([{ path: '/v/S.md', stem: 'S', content: '[[S]] [[T]]' }])
    expect(g.edges).toHaveLength(1)
    expect(g.nodes.find((n) => n.label === 'S')?.degree).toBe(1)
  })
})

describe('per-note facts', () => {
  it('counts words and records the folder relative to the vault root', () => {
    const g = buildGraph(
      [
        { path: '/v/notes/A.md', stem: 'A', content: 'three little words', mtimeMs: 42 },
        { path: '/v/B.md', stem: 'B', content: '' }
      ],
      '/v'
    )
    const a = g.nodes.find((n) => n.label === 'A')!
    expect(a).toMatchObject({ words: 3, folder: 'notes', mtimeMs: 42 })
    expect(g.nodes.find((n) => n.label === 'B')).toMatchObject({ folder: '', words: 0, mtimeMs: 0 })
  })

  it('leaves ghosts without note facts', () => {
    const g = buildGraph([{ path: '/v/A.md', stem: 'A', content: 'see [[Nowhere]]' }], '/v')
    expect(g.nodes.find((n) => n.label === 'Nowhere')).toMatchObject({
      exists: false,
      words: 0,
      mtimeMs: 0
    })
  })
})

describe('tags', () => {
  it('records each note\'s tags once', () => {
    const g = buildGraph(
      [{ path: '/v/A.md', stem: 'A', content: '#project notes about #rust and #rust again' }],
      '/v'
    )
    expect(g.nodes[0]!.tags).toEqual(['project', 'rust'])
  })

  it('leaves ghosts with no tags', () => {
    const g = buildGraph([{ path: '/v/A.md', stem: 'A', content: '[[Missing]] #real' }], '/v')
    expect(g.nodes.find((n) => !n.exists)!.tags).toEqual([])
  })
})
