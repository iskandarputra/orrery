import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildGraph, type GraphFile } from '@core/graph'
import { analyzeGraph } from '@core/metrics'
import { findLinkLines } from '@core/wikilinks'
import type { BacklinkHit, GraphAnalysis } from '@shared/types'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_HITS = 200

/**
 * Finds [[wikilink]] references to a note across the workspace. A plain
 * recursive scan is deliberate for now — no index to invalidate, and fast
 * enough for personal-vault sizes. Swap for a persistent index when the
 * knowledge layer grows (the IPC contract stays the same).
 */
export class LinkScanner {
  async scan(rootPath: string, targetStem: string): Promise<BacklinkHit[]> {
    const hits: BacklinkHit[] = []
    await this.walk(rootPath, targetStem, hits)
    return hits
  }

  /** Read every note, build the vault's wikilink graph, and analyse it. */
  async graph(rootPath: string): Promise<GraphAnalysis> {
    const files: GraphFile[] = []
    const visit = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(full)
        } else if (entry.isFile() && /\.(md|markdown|mdown|mkd)$/i.test(entry.name)) {
          try {
            const stat = await fs.stat(full)
            if (stat.size > MAX_FILE_BYTES) continue
            files.push({
              path: full,
              stem: entry.name.replace(/\.[^.]+$/, ''),
              content: await fs.readFile(full, 'utf-8'),
              mtimeMs: stat.mtimeMs
            })
          } catch {
            // skip unreadable
          }
        }
      }
    }
    await visit(rootPath)
    // One pass over the vault feeds both the graph and its analysis, so every
    // surface (graph, analytics view, note panel) reads the same numbers.
    return analyzeGraph(buildGraph(files, rootPath), { now: Date.now() })
  }

  /** Full-text search; plain queries are matched literally, or as a regex. */
  async search(
    rootPath: string,
    query: string,
    useRegex: boolean,
    caseSensitive: boolean
  ): Promise<BacklinkHit[]> {
    let matcher: RegExp
    try {
      const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      matcher = new RegExp(source, caseSensitive ? '' : 'i')
    } catch {
      return []
    }
    const hits: BacklinkHit[] = []
    const visit = async (dir: string): Promise<void> => {
      if (hits.length >= MAX_HITS) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (hits.length >= MAX_HITS) return
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(full)
        } else if (entry.isFile() && /\.(md|markdown|mdown|mkd)$/i.test(entry.name)) {
          try {
            const stat = await fs.stat(full)
            if (stat.size > MAX_FILE_BYTES) continue
            const lines = (await fs.readFile(full, 'utf-8')).split('\n')
            for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
              if (matcher.test(lines[i]!)) {
                hits.push({ path: full, line: i + 1, snippet: lines[i]!.trim().slice(0, 200) })
              }
            }
          } catch {
            // unreadable — skip
          }
        }
      }
    }
    await visit(rootPath)
    return hits
  }

  private async walk(dir: string, targetStem: string, hits: BacklinkHit[]): Promise<void> {
    if (hits.length >= MAX_HITS) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= MAX_HITS) return
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.walk(full, targetStem, hits)
      } else if (entry.isFile() && /\.(md|markdown|mdown|mkd)$/i.test(entry.name)) {
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          const content = await fs.readFile(full, 'utf-8')
          for (const hit of findLinkLines(content, targetStem)) {
            hits.push({ path: full, line: hit.line, snippet: hit.snippet })
            if (hits.length >= MAX_HITS) return
          }
        } catch {
          // unreadable file — skip
        }
      }
    }
  }
}
