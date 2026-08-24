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
