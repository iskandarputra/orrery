import type { GraphEdge, GraphNode, LinkGraph } from '@shared/types'
import { findImports, importsFamily, indexImports, resolveImport } from './code-links'
import { resolve } from './link-resolution'
import { dirname } from './paths'
import { findTags } from './tags'
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

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** A note or a source file, decided by extension. */
function kindOf(filePath: string): 'note' | 'code' {
  return MARKDOWN.test(filePath) ? 'note' : 'code'
}

/** Folder holding the note, relative to the vault root ('' at the root). */
function folderOf(filePath: string, rootPath: string): string {
  const dir = dirname(filePath)
  if (!rootPath || !dir.startsWith(rootPath)) return ''
  return dir.slice(rootPath.length).replace(/^[/\\]/, '')
}

/** File name without its extension, for labelling a path that has no file. */
function stemOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
}

/**
 * Build the vault link graph from file contents (pure — tested in Node).
 *
 * Two kinds of edge, because a vault that holds code has two kinds of link.
 * Notes point at each other with `[[wikilinks]]`; source files point at each
 * other with imports. Both are drawn, and a wikilink naming a source file
 * connects the two halves, which is the point of having them in one map.
 *
 * Nodes carry the per-file facts analysis needs — words, folder, mtime — so
 * the vault is read once; `analyzeGraph` adds the structural measures.
 */
export function buildGraph(files: GraphFile[], rootPath = ''): LinkGraph {
  // Every file carrying a stem, not the last one seen. A plain `Map.set` in
  // this loop left whichever file the walk reached last, which is how the map
  // came to draw an edge to a different Store.md than a click would open.
  const byStem = new Map<string, string[]>()
  for (const f of files) {
    const key = f.stem.toLowerCase()
    const bucket = byStem.get(key)
    if (bucket) bucket.push(f.path)
    else byStem.set(key, [f.path])
  }

  const nodes = new Map<string, GraphNode>()
  for (const f of files) {
    nodes.set(f.path, {
      id: f.path,
      label: f.stem,
      exists: true,
      kind: kindOf(f.path),
      degree: 0,
      folder: folderOf(f.path, rootPath),
      words: f.content.match(WORD_RE)?.length ?? 0,
      mtimeMs: f.mtimeMs ?? 0,
      tags: [...new Set(findTags(f.content).map((t) => t.tag))]
    })
  }

  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const f of files) {
    for (const link of findWikilinks(f.content)) {
      const found = resolve(f.path, byStem.get(link.target.toLowerCase()) ?? [], {
        tieBreak: 'nearest',
        whenEmpty: { status: 'missing', at: link.target }
      })
      // A wikilink to nothing is a note somebody intends to write, and the
      // editor already offers to create it on click, so the graph keeps it.
      const to = found.status === 'resolved' ? found.to : `ghost:${link.target.toLowerCase()}`
      if (found.status !== 'resolved' && !nodes.has(to)) {
        // A linked-but-missing note: no file, so no words, folder or mtime.
        nodes.set(to, {
          id: to,
          label: link.target,
          exists: false,
          kind: 'note',
          degree: 0,
          folder: '',
          words: 0,
          mtimeMs: 0,
          tags: []
        })
      }
      if (to === f.path) continue // self-link
      const key = `${f.path}→${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        from: f.path,
        to,
        kind: 'link',
        ambiguous: found.status === 'resolved' && found.ambiguous
      })
      nodes.get(f.path)!.degree++
      nodes.get(to)!.degree++
    }
  }

  // Imports, for the files that have them. Only edges to files that are in the
  // vault: a dependency on `react` is real but it is not part of this folder,
  // and drawing every package would bury the map it is meant to be.
  // Indexed once. Handing `resolveImport` a plain array made it rebuild a Set
  // of every file in the vault, and scan every file again for a bare module
  // name, on each of the tens of thousands of imports it was asked about.
  const index = indexImports(files.map((f) => f.path))
  for (const f of files) {
    if (!importsFamily(f.path)) continue
    for (const found of findImports(f.content, f.path)) {
      const where = resolveImport(f.path, found.spec, index)
      // A package is a real dependency and not part of this folder, and a
      // refusal is a guess not worth making. Neither draws anything.
      if (where.status === 'external' || where.status === 'ambiguous') continue
      const to = where.status === 'resolved' ? where.to : `missing:${where.at}`
      if (where.status === 'missing' && !nodes.has(to)) {
        // What a rename leaves behind. Rare by construction, so it does not
        // fill the map, and when one appears it is the thing worth seeing.
        nodes.set(to, {
          id: to,
          label: stemOfPath(where.at),
          exists: false,
          kind: 'code',
          degree: 0,
          folder: '',
          words: 0,
          mtimeMs: 0,
          tags: []
        })
      }
      if (to === f.path) continue
      const key = `${f.path}→${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: f.path, to, kind: 'import', ambiguous: false })
      nodes.get(f.path)!.degree++
      nodes.get(to)!.degree++
    }
  }

  return { nodes: [...nodes.values()], edges }
}
