import type { GraphNode, LinkGraph } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { noteCentroid, suggestLinks } from './suggestions'

function node(id: string): GraphNode {
  return {
    id,
    label: id,
    exists: true,
    kind: 'note',
    degree: 0,
    folder: '',
    words: 0,
    mtimeMs: 0,
    tags: []
  }
}

function graph(ids: string[], links: [string, string][]): LinkGraph {
  return {
    nodes: ids.map(node),
    edges: links.map(([from, to]) => ({
      from,
      to,
      kind: 'link' as const,
      ambiguous: false,
      line: 1
    }))
  }
}

describe('noteCentroid', () => {
  it('averages chunk vectors into a unit vector', () => {
    const centroid = noteCentroid([
      [3, 0],
      [0, 3]
    ])
    expect(centroid[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(centroid[1]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('returns an empty vector for no chunks', () => {
    expect(noteCentroid([])).toEqual([])
  })
})

describe('suggestLinks', () => {
  const vectors = new Map<string, number[]>([
    ['/v/A.md', [1, 0]],
    ['/v/Twin.md', [0.99, 0.14]], // nearly the same topic as A
    ['/v/Linked.md', [0.98, 0.2]], // also close, but already linked
    ['/v/Other.md', [0, 1]] // unrelated
  ])

  it('suggests the semantically close note that is not linked yet', () => {
    const g = graph(
      ['/v/A.md', '/v/Twin.md', '/v/Linked.md', '/v/Other.md'],
      [['/v/A.md', '/v/Linked.md']]
    )
    const suggestions = suggestLinks({ from: '/v/A.md', vectors, graph: g })
    expect(suggestions.map((s) => s.id)).toEqual(['/v/Twin.md'])
    expect(suggestions[0]!.similarity).toBeGreaterThan(0.9)
  })

  it('never suggests a note that is already linked, in either direction', () => {
    const g = graph(
      ['/v/A.md', '/v/Twin.md'],
      [['/v/Twin.md', '/v/A.md']] // incoming link still counts as linked
    )
    expect(suggestLinks({ from: '/v/A.md', vectors, graph: g })).toEqual([])
  })

  it('reports how far apart the two notes currently are', () => {
    // A → Linked → Twin: Twin is two hops away.
    const g = graph(
      ['/v/A.md', '/v/Twin.md', '/v/Linked.md'],
      [
        ['/v/A.md', '/v/Linked.md'],
        ['/v/Linked.md', '/v/Twin.md']
      ]
    )
    const [twin] = suggestLinks({ from: '/v/A.md', vectors, graph: g })
    expect(twin?.hops).toBe(2)
  })

  it('reports no path when the notes are in separate islands', () => {
    const g = graph(['/v/A.md', '/v/Twin.md'], [])
    const [twin] = suggestLinks({ from: '/v/A.md', vectors, graph: g })
    expect(twin?.hops).toBeNull()
  })

  it('ranks a distant pair above an equally similar near pair', () => {
    const close = new Map<string, number[]>([
      ['/v/A.md', [1, 0]],
      ['/v/Near.md', [0.99, 0.14]],
      ['/v/Far.md', [0.99, 0.14]],
      ['/v/Hop.md', [0, 1]]
    ])
    // Near is two hops from A; Far is in another island entirely.
    const g = graph(
      ['/v/A.md', '/v/Near.md', '/v/Far.md', '/v/Hop.md'],
      [
        ['/v/A.md', '/v/Hop.md'],
        ['/v/Hop.md', '/v/Near.md']
      ]
    )
    const ranked = suggestLinks({ from: '/v/A.md', vectors: close, graph: g })
    expect(ranked.map((s) => s.id)).toEqual(['/v/Far.md', '/v/Near.md'])
  })

  it('drops notes below the similarity floor', () => {
    const g = graph(['/v/A.md', '/v/Other.md'], [])
    expect(suggestLinks({ from: '/v/A.md', vectors, graph: g, minSimilarity: 0.5 })).toEqual([])
  })

  it('returns nothing when the note has no vector yet', () => {
    const g = graph(['/v/Unindexed.md', '/v/Twin.md'], [])
    expect(suggestLinks({ from: '/v/Unindexed.md', vectors, graph: g })).toEqual([])
  })
})
