import { describe, expect, it } from 'vitest'
import { filterGraphView, rankByFrequency, type GraphViewFilter } from './graph-view'

const nodes = (spec: Record<string, boolean>): Map<string, { exists: boolean }> =>
  new Map(Object.entries(spec).map(([id, exists]) => [id, { exists }]))

const edges = (...pairs: string[]): { from: string; to: string }[] =>
  pairs.map((p) => ({ from: p.split('-')[0]!, to: p.split('-')[1]! }))

const filter = (over: Partial<GraphViewFilter> = {}): GraphViewFilter => ({
  ghosts: true,
  orphans: true,
  local: false,
  depth: 1,
  center: null,
  ...over
})

const ids = (result: { ids: Set<string> }): string[] => [...result.ids].sort()

describe('ghosts', () => {
  it('drops notes that are only linked to when asked', () => {
    const graph = nodes({ a: true, b: true, ghost: false })
    expect(ids(filterGraphView(graph, edges('a-b', 'a-ghost'), filter({ ghosts: false })))).toEqual(
      ['a', 'b']
    )
  })

  it('drops the edges into them too', () => {
    const result = filterGraphView(
      nodes({ a: true, ghost: false }),
      edges('a-ghost'),
      filter({ ghosts: false })
    )
    expect(result.edges).toEqual([])
  })

  it('keeps them by default', () => {
    expect(ids(filterGraphView(nodes({ a: true, g: false }), [], filter()))).toEqual(['a', 'g'])
  })
})

describe('local view', () => {
  const chain = nodes({ a: true, b: true, c: true, d: true, far: true })
  const links = edges('a-b', 'b-c', 'c-d')

  it('keeps one hop out', () => {
    expect(
      ids(filterGraphView(chain, links, filter({ local: true, center: 'a', depth: 1 })))
    ).toEqual(['a', 'b'])
  })

  it('reaches further as the depth goes up', () => {
    expect(
      ids(filterGraphView(chain, links, filter({ local: true, center: 'a', depth: 3 })))
    ).toEqual(['a', 'b', 'c', 'd'])
  })

  it('follows links in both directions', () => {
    // `a-b` points one way, but standing on b you still expect to see a.
    expect(
      ids(filterGraphView(chain, links, filter({ local: true, center: 'b', depth: 1 })))
    ).toEqual(['a', 'b', 'c'])
  })

  it('says it needs a centre rather than reporting an empty graph', () => {
    // Distinct states: there is nowhere to stand, versus nothing to see.
    const result = filterGraphView(chain, links, filter({ local: true, center: null }))
    expect(result.needsCenter).toBe(true)
    expect(result.ids.size).toBe(0)
  })

  it('needs a centre that survived the ghost filter', () => {
    const result = filterGraphView(
      nodes({ a: true, g: false }),
      [],
      filter({ ghosts: false, local: true, center: 'g' })
    )
    expect(result.needsCenter).toBe(true)
  })

  it('stops early rather than looping on a cycle', () => {
    const ring = nodes({ a: true, b: true, c: true })
    expect(
      ids(
        filterGraphView(
          ring,
          edges('a-b', 'b-c', 'c-a'),
          filter({ local: true, center: 'a', depth: 9 })
        )
      )
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('orphans', () => {
  it('drops notes with no links', () => {
    const graph = nodes({ a: true, b: true, lonely: true })
    expect(ids(filterGraphView(graph, edges('a-b'), filter({ orphans: false })))).toEqual([
      'a',
      'b'
    ])
  })

  it('counts orphans after the other filters, not before', () => {
    // `b` has a link, but only to a ghost. Once ghosts go, b is an orphan —
    // checking first would have kept it and drawn a note with no edges.
    const graph = nodes({ a: true, b: true, g: false })
    const result = filterGraphView(graph, edges('b-g'), filter({ ghosts: false, orphans: false }))
    expect(ids(result)).toEqual([])
  })

  it('keeps them by default', () => {
    expect(ids(filterGraphView(nodes({ lonely: true }), [], filter()))).toEqual(['lonely'])
  })
})

describe('edges', () => {
  it('never returns an edge whose ends were filtered away', () => {
    const result = filterGraphView(
      nodes({ a: true, b: true, g: false }),
      edges('a-b', 'a-g', 'g-b'),
      filter({ ghosts: false })
    )
    for (const edge of result.edges) {
      expect(result.ids.has(edge.from)).toBe(true)
      expect(result.ids.has(edge.to)).toBe(true)
    }
    expect(result.edges).toHaveLength(1)
  })

  it('handles an empty graph', () => {
    const result = filterGraphView(new Map(), [], filter())
    expect(result.ids.size).toBe(0)
    expect(result.needsCenter).toBe(false)
  })
})

describe('rankByFrequency', () => {
  it('ranks the commonest first', () => {
    const ranks = rankByFrequency(['a', 'b', 'a', 'c', 'a', 'b'])
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(2)
  })

  it('breaks ties by name, so equal clusters do not swap colours', () => {
    expect([...rankByFrequency(['z', 'a']).keys()]).toEqual(['a', 'z'])
  })

  it('handles numbers and an empty list', () => {
    expect(rankByFrequency([2, 2, 1]).get('2')).toBe(0)
    expect(rankByFrequency([]).size).toBe(0)
  })
})
