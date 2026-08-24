import type { GraphData, GraphEdge, GraphNode } from '@shared/types'
import { findWikilinks } from './wikilinks'

/** Build the vault link graph from note contents (pure — tested in Node). */
export function buildGraph(files: { path: string; stem: string; content: string }[]): GraphData {
  const byStem = new Map<string, string>()
  for (const f of files) byStem.set(f.stem.toLowerCase(), f.path)

  const nodes = new Map<string, GraphNode>()
  for (const f of files) {
    nodes.set(f.path, { id: f.path, label: f.stem, exists: true, degree: 0 })
  }

  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const f of files) {
    for (const link of findWikilinks(f.content)) {
      const targetPath = byStem.get(link.target.toLowerCase())
      const to = targetPath ?? `ghost:${link.target.toLowerCase()}`
      if (!targetPath && !nodes.has(to)) {
        nodes.set(to, { id: to, label: link.target, exists: false, degree: 0 })
      }
      if (to === f.path) continue // self-link
      const key = `${f.path}→${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: f.path, to })
      nodes.get(f.path)!.degree++
      nodes.get(to)!.degree++
    }
  }
  return { nodes: [...nodes.values()], edges }
}
