import type { AnalyzedGraphNode } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildMocSkeleton, mocPrompt } from './moc'

function note(label: string, over: Partial<AnalyzedGraphNode> = {}): AnalyzedGraphNode {
  return {
    id: `/v/${label}.md`,
    label,
    exists: true,
    degree: 0,
    folder: '',
    words: 100,
    mtimeMs: 0,
    inDegree: 0,
    outDegree: 0,
    pagerank: 0.1,
    betweenness: 0,
    component: 0,
    community: 0,
    ...over
  }
}

const cluster = [
  note('Rust', { pagerank: 0.3, inDegree: 4 }),
  note('Ownership', { pagerank: 0.2, inDegree: 2 }),
  note('Cargo', { pagerank: 0.05, inDegree: 1 }),
  note('Stub', { pagerank: 0.01, inDegree: 0, outDegree: 0, words: 3 })
]

describe('buildMocSkeleton', () => {
  it('titles the map after the most influential note', () => {
    expect(buildMocSkeleton(cluster).title).toBe('Rust')
  })

  it('lists every note as a wikilink, most influential first', () => {
    const { markdown } = buildMocSkeleton(cluster)
    expect(markdown).toContain('[[Rust]]')
    expect(markdown).toContain('[[Cargo]]')
    expect(markdown.indexOf('[[Rust]]')).toBeLessThan(markdown.indexOf('[[Cargo]]'))
  })

  it('separates the well-connected notes from the loose ends', () => {
    const { markdown } = buildMocSkeleton(cluster)
    const core = markdown.indexOf('[[Ownership]]')
    const loose = markdown.indexOf('[[Stub]]')
    expect(core).toBeGreaterThan(-1)
    expect(loose).toBeGreaterThan(core) // orphaned notes come last
  })

  it('is useful with no model available at all', () => {
    const { markdown } = buildMocSkeleton(cluster)
    expect(markdown).not.toContain('{{')
    expect(markdown.split('\n').filter((l) => l.startsWith('- ')).length).toBe(cluster.length)
  })

  it('handles a cluster of one', () => {
    const { title, markdown } = buildMocSkeleton([note('Alone')])
    expect(title).toBe('Alone')
    expect(markdown).toContain('[[Alone]]')
  })
})

describe('mocPrompt', () => {
  it('asks for prose about these notes and names every one', () => {
    const prompt = mocPrompt(buildMocSkeleton(cluster), cluster)
    for (const n of cluster) expect(prompt).toContain(n.label)
    expect(prompt.toLowerCase()).toContain('map of content')
  })
})
