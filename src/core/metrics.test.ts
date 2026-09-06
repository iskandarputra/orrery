import type { GraphNode, LinkGraph } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph'
import { analyzeGraph } from './metrics'

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    exists: true,
    kind: 'note',
    degree: 0,
    folder: '',
    words: 0,
    mtimeMs: 0,
    tags: [],
    ...over
  }
}

function graph(ids: string[], links: [string, string][]): LinkGraph {
  return {
    nodes: ids.map((id) => node(id)),
    edges: links.map(([from, to]) => ({
      from,
      to,
      kind: 'link' as const,
      ambiguous: false,
      line: 1
    }))
  }
}

/** Metrics of one node, by id. */
function of(analysis: ReturnType<typeof analyzeGraph>, id: string) {
  return analysis.nodes.find((n) => n.id === id)!
}

describe('degrees', () => {
  it('separates links in from links out', () => {
    const a = analyzeGraph(
      graph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['A', 'C'],
          ['B', 'C']
        ]
      )
    )
    expect([of(a, 'A').outDegree, of(a, 'A').inDegree]).toEqual([2, 0])
    expect([of(a, 'B').outDegree, of(a, 'B').inDegree]).toEqual([1, 1])
    expect([of(a, 'C').outDegree, of(a, 'C').inDegree]).toEqual([0, 2])
  })
})

describe('pagerank', () => {
  it('sums to one and is symmetric on a mutual pair', () => {
    const a = analyzeGraph(
      graph(
        ['A', 'B'],
        [
          ['A', 'B'],
          ['B', 'A']
        ]
      )
    )
    const total = a.nodes.reduce((sum, n) => sum + n.pagerank, 0)
    expect(total).toBeCloseTo(1, 6)
    expect(of(a, 'A').pagerank).toBeCloseTo(of(a, 'B').pagerank, 6)
  })

  it('ranks a well-linked note above a rarely-linked one', () => {
    // Everyone links to Hub; only A links to Quiet.
    const a = analyzeGraph(
      graph(
        ['Hub', 'Quiet', 'A', 'B', 'C'],
        [
          ['A', 'Hub'],
          ['B', 'Hub'],
          ['C', 'Hub'],
          ['A', 'Quiet']
        ]
      )
    )
    expect(of(a, 'Hub').pagerank).toBeGreaterThan(of(a, 'Quiet').pagerank)
    expect(a.insights.hubs[0]?.id).toBe('Hub')
  })

  it('keeps the total at one when a note links nowhere', () => {
    const a = analyzeGraph(graph(['A', 'B', 'C'], [['A', 'B']]))
    expect(a.nodes.reduce((sum, n) => sum + n.pagerank, 0)).toBeCloseTo(1, 6)
  })
})

describe('betweenness', () => {
  it('credits only the note in the middle of a path', () => {
    const a = analyzeGraph(
      graph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C']
        ]
      )
    )
    expect(of(a, 'B').betweenness).toBeGreaterThan(0)
    expect(of(a, 'A').betweenness).toBe(0)
    expect(of(a, 'C').betweenness).toBe(0)
  })

  it('names the bridge between two clusters as the top connector', () => {
    const a = analyzeGraph(
      graph(
        ['a1', 'a2', 'a3', 'BRIDGE', 'b1', 'b2', 'b3'],
        [
          ['a1', 'a2'],
          ['a2', 'a3'],
          ['a3', 'a1'],
          ['a1', 'BRIDGE'],
          ['BRIDGE', 'b1'],
          ['b1', 'b2'],
          ['b2', 'b3'],
          ['b3', 'b1']
        ]
      )
    )
    expect(a.insights.connectors[0]?.id).toBe('BRIDGE')
  })
})

describe('components and communities', () => {
  it('separates disconnected islands', () => {
    const a = analyzeGraph(
      graph(
        ['A', 'B', 'X', 'Y'],
        [
          ['A', 'B'],
          ['X', 'Y']
        ]
      )
    )
    expect(a.stats.components).toBe(2)
    expect(of(a, 'A').component).toBe(of(a, 'B').component)
    expect(of(a, 'A').component).not.toBe(of(a, 'X').component)
    expect(a.stats.largestComponentShare).toBeCloseTo(0.5, 6)
  })

  it('never puts two islands in one community', () => {
    const a = analyzeGraph(
      graph(
        ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'],
        [
          ['a1', 'a2'],
          ['a2', 'a3'],
          ['a3', 'a1'],
          ['b1', 'b2'],
          ['b2', 'b3'],
          ['b3', 'b1']
        ]
      )
    )
    expect(of(a, 'a1').community).toBe(of(a, 'a2').community)
    expect(of(a, 'a1').community).not.toBe(of(a, 'b1').community)
  })
})

describe('insights', () => {
  it('finds orphans, dead ends and broken links', () => {
    const g: LinkGraph = {
      nodes: [
        node('A'),
        node('B'),
        node('Lonely'),
        node('ghost:missing', { label: 'missing', exists: false })
      ],
      edges: [
        { from: 'A', to: 'B', kind: 'link' as const, ambiguous: false, line: 1 },
        { from: 'A', to: 'ghost:missing', kind: 'link' as const, ambiguous: false, line: 1 }
      ]
    }
    const a = analyzeGraph(g)
    expect(a.insights.orphans.map((n) => n.id)).toEqual(['Lonely'])
    expect(a.insights.deadEnds.map((n) => n.id)).toEqual(['B'])
    expect(a.insights.brokenLinks).toEqual([
      { id: 'ghost:missing', label: 'missing', kind: 'note', from: ['A'] }
    ])
  })

  it('does not count a ghost as an orphan or a dead end', () => {
    const g: LinkGraph = {
      nodes: [node('A'), node('ghost:x', { label: 'x', exists: false })],
      edges: [{ from: 'A', to: 'ghost:x', kind: 'link' as const, ambiguous: false, line: 1 }]
    }
    const a = analyzeGraph(g)
    expect(a.insights.orphans).toEqual([])
    expect(a.insights.deadEnds).toEqual([])
  })
})

describe('vault stats', () => {
  it('counts notes, ghosts, links and words', () => {
    const g: LinkGraph = {
      nodes: [
        node('A', { words: 100 }),
        node('B', { words: 50 }),
        node('ghost:g', { label: 'g', exists: false })
      ],
      edges: [
        { from: 'A', to: 'B', kind: 'link' as const, ambiguous: false, line: 1 },
        { from: 'A', to: 'ghost:g', kind: 'link' as const, ambiguous: false, line: 1 }
      ]
    }
    const a = analyzeGraph(g)
    expect(a.stats).toMatchObject({ notes: 2, ghosts: 1, links: 2, words: 150 })
    expect(a.stats.avgOutDegree).toBeCloseTo(1, 6) // 2 links over 2 real notes
  })

  it('buckets notes by out-link count', () => {
    const a = analyzeGraph(
      graph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['A', 'C']
        ]
      )
    )
    expect(a.stats.linkHistogram[0]).toBe(2) // B and C link nowhere
    expect(a.stats.linkHistogram[2]).toBe(1) // A links twice
  })

  it('counts recent activity against a fixed clock', () => {
    const day = 24 * 60 * 60 * 1000
    const now = 1_000 * day
    const g: LinkGraph = {
      nodes: [
        node('fresh', { mtimeMs: now - 2 * day }),
        node('older', { mtimeMs: now - 20 * day }),
        node('stale', { mtimeMs: now - 200 * day })
      ],
      edges: []
    }
    const a = analyzeGraph(g, { now })
    expect(a.stats.modified).toEqual({ last7: 1, last30: 2, last90: 2 })
  })
})

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const g = graph(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['c', 'd'],
        ['d', 'e'],
        ['e', 'f'],
        ['f', 'd']
      ]
    )
    expect(JSON.stringify(analyzeGraph(g))).toBe(JSON.stringify(analyzeGraph(g)))
  })

  it('handles an empty vault', () => {
    const a = analyzeGraph({ nodes: [], edges: [] })
    expect(a.stats.notes).toBe(0)
    expect(a.stats.largestComponentShare).toBe(0)
    expect(a.insights.hubs).toEqual([])
  })
})

describe('scale', () => {
  it('analyses a few thousand notes well inside a UI budget', () => {
    // A vault far larger than the ones this ships for: 5k notes, ~20k links.
    const ids = Array.from({ length: 5000 }, (_, i) => `n${i}`)
    const links: [string, string][] = []
    for (let i = 0; i < ids.length; i++) {
      for (const hop of [1, 7, 53, 501]) {
        links.push([ids[i]!, ids[(i * hop + 1) % ids.length]!])
      }
    }
    const started = performance.now()
    const a = analyzeGraph(graph(ids, links))
    const elapsed = performance.now() - started
    expect(a.nodes).toHaveLength(5000)
    // A guard against an algorithmic blow-up (an accidentally quadratic pass
    // takes minutes here), not a benchmark: the ceiling is deliberately far
    // above the ~0.6s this actually runs in, so a busy CI core can't fail it.
    expect(elapsed).toBeLessThan(15_000)
    console.log(`  analyzeGraph: 5000 nodes / ${links.length} links in ${Math.round(elapsed)}ms`)
  })
})

describe('broken links of two kinds', () => {
  it('tells an unwritten note apart from an import that resolves nowhere', () => {
    const analysis = analyzeGraph(
      buildGraph(
        [
          { path: '/v/note.md', stem: 'note', content: 'see [[Nowhere]]' },
          { path: '/v/app.ts', stem: 'app', content: "import x from './gone'" }
        ],
        '/v'
      )
    )
    const kinds = Object.fromEntries(analysis.insights.brokenLinks.map((b) => [b.id, b.kind]))
    expect(kinds['ghost:nowhere']).toBe('note')
    expect(kinds['missing:/v/gone']).toBe('import')
  })
})
