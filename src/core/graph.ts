import type { GraphEdge, GraphNode, LinkGraph } from '@shared/types'
import { dirname } from './paths'
import { findWikilinks } from './wikilinks'

/** Same definition of a word as the editor's live counter. */
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export interface GraphFile {
  path: string
  stem: string
  content: string
  /** Last-modified time, epoch ms. Absent for callers that don't stat. */
  mtimeMs?: number
}

/** Folder holding the note, relative to the vault root ('' at the root). */
function folderOf(filePath: string, rootPath: string): string {
  const dir = dirname(filePath)
  if (!rootPath || !dir.startsWith(rootPath)) return ''
  return dir.slice(rootPath.length).replace(/^[/\\]/, '')
}

/**
 * Build the vault link graph from note contents (pure — tested in Node).
 * Nodes carry the per-note facts analysis needs — words, folder, mtime — so
 * the vault is read once; `analyzeGraph` adds the structural measures.
 */
export function buildGraph(files: GraphFile[], rootPath = ''): LinkGraph {
  const byStem = new Map<string, string>()
  for (const f of files) byStem.set(f.stem.toLowerCase(), f.path)

  const nodes = new Map<string, GraphNode>()
  for (const f of files) {
    nodes.set(f.path, {
      id: f.path,
      label: f.stem,
      exists: true,
      degree: 0,
      folder: folderOf(f.path, rootPath),
      words: f.content.match(WORD_RE)?.length ?? 0,
      mtimeMs: f.mtimeMs ?? 0
    })
  }

  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const f of files) {
    for (const link of findWikilinks(f.content)) {
      const targetPath = byStem.get(link.target.toLowerCase())
      const to = targetPath ?? `ghost:${link.target.toLowerCase()}`
      if (!targetPath && !nodes.has(to)) {
        // A linked-but-missing note: no file, so no words, folder or mtime.
        nodes.set(to, {
          id: to,
          label: link.target,
          exists: false,
          degree: 0,
          folder: '',
          words: 0,
          mtimeMs: 0
        })
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
