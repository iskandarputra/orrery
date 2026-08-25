import type { AnalyzedGraphNode } from '@shared/types'

/** Below this, a note is a loose end rather than part of the cluster's spine. */
const LOOSE_END_LINKS = 1

export interface MocSkeleton {
  /** The cluster's name — its most influential note. */
  title: string
  markdown: string
}

/**
 * A Map of Content for one cluster, built from the analysis alone.
 *
 * Deliberately useful with no model configured: the structure — which notes
 * lead, which are loose ends, and the links between them — comes from the graph,
 * and a model only adds the framing prose. An AI feature that produces nothing
 * without an API key isn't a feature.
 */
export function buildMocSkeleton(cluster: readonly AnalyzedGraphNode[]): MocSkeleton {
  const ranked = [...cluster].sort(
    (a, b) => b.pagerank - a.pagerank || a.label.localeCompare(b.label)
  )
  const title = ranked[0]?.label ?? 'Cluster'
  const core = ranked.filter((n) => n.inDegree + n.outDegree > LOOSE_END_LINKS)
  const looseEnds = ranked.filter((n) => n.inDegree + n.outDegree <= LOOSE_END_LINKS)

  const lines = [`# ${title} — Map of Content`, '']
  if (core.length > 0) {
    lines.push('## Core notes', '')
    for (const note of core) {
      lines.push(`- [[${note.label}]] — ${note.inDegree} in · ${note.outDegree} out`)
    }
    lines.push('')
  }
  if (looseEnds.length > 0) {
    lines.push('## Loose ends', '', '_Barely linked — worth connecting or folding in._', '')
    for (const note of looseEnds) lines.push(`- [[${note.label}]] — ${note.words} words`)
    lines.push('')
  }

  return { title, markdown: lines.join('\n') }
}

/** Asks a model for the framing paragraph the graph can't supply. */
export function mocPrompt(skeleton: MocSkeleton, cluster: readonly AnalyzedGraphNode[]): string {
  const listing = [...cluster]
    .sort((a, b) => b.pagerank - a.pagerank)
    .map((n) => `- ${n.label} (${n.inDegree} links in, ${n.outDegree} out, ${n.words} words)`)
    .join('\n')

  return [
    `Write the opening of a Map of Content note titled "${skeleton.title}".`,
    '',
    'These notes were grouped together by link structure alone:',
    listing,
    '',
    'In at most four sentences, say what this group of notes is about and how',
    'they relate. Write plain markdown prose, no heading, no bullet list, and',
    'do not invent notes that are not listed.'
  ].join('\n')
}
