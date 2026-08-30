import type { GraphNode, LinkGraph } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { selectContext, type ScoredChunk } from './retrieval'

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
    edges: links.map(([from, to]) => ({ from, to, kind: 'link' as const }))
  }
}

const chunk = (path: string, score: number, line = 1): ScoredChunk => ({
  path,
  line,
  text: `${path} chunk`,
  score
})

describe('selectContext', () => {
  const g = graph(['/A.md', '/B.md', '/C.md', '/far.md'], [['/A.md', '/B.md']])

  it('keeps the plain ranking when nothing is linked', () => {
    const chunks = [chunk('/C.md', 0.9), chunk('/far.md', 0.8)]
    const picked = selectContext({ chunks, graph: graph(['/C.md', '/far.md'], []), k: 2 })
    expect(picked.map((c) => c.path)).toEqual(['/C.md', '/far.md'])
  })

  it('pulls in a note linked from the best hit over an unrelated one', () => {
    // B scores below far.md on text alone, but A (the top hit) links to it.
    const chunks = [chunk('/A.md', 0.9), chunk('/far.md', 0.72), chunk('/B.md', 0.7)]
    const picked = selectContext({ chunks, graph: g, k: 2, seeds: 1 })
    expect(picked.map((c) => c.path)).toEqual(['/A.md', '/B.md'])
  })

  it('does not let the bonus beat a much stronger match', () => {
    const chunks = [chunk('/A.md', 0.9), chunk('/far.md', 0.88), chunk('/B.md', 0.4)]
    const picked = selectContext({ chunks, graph: g, k: 2, seeds: 1 })
    expect(picked.map((c) => c.path)).toEqual(['/A.md', '/far.md'])
  })

  it('follows links in either direction', () => {
    const incoming = graph(['/A.md', '/B.md'], [['/B.md', '/A.md']])
    const chunks = [chunk('/A.md', 0.9), chunk('/B.md', 0.5)]
    const picked = selectContext({ chunks, graph: incoming, k: 2, seeds: 1 })
    expect(picked.map((c) => c.path)).toEqual(['/A.md', '/B.md'])
  })

  it('never returns two chunks from the same line twice', () => {
    const chunks = [chunk('/A.md', 0.9), chunk('/A.md', 0.9)]
    expect(selectContext({ chunks, graph: g, k: 5 })).toHaveLength(1)
  })

  it('caps how much of the context one note can take', () => {
    const chunks = [
      chunk('/A.md', 0.95, 1),
      chunk('/A.md', 0.94, 5),
      chunk('/A.md', 0.93, 9),
      chunk('/A.md', 0.92, 13),
      chunk('/C.md', 0.5, 1)
    ]
    const picked = selectContext({ chunks, graph: g, k: 4, perNote: 2 })
    expect(picked.filter((c) => c.path === '/A.md')).toHaveLength(2)
    expect(picked.map((c) => c.path)).toContain('/C.md')
  })

  it('returns nothing for no chunks', () => {
    expect(selectContext({ chunks: [], graph: g, k: 5 })).toEqual([])
  })
})
