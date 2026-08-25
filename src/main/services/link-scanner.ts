import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fingerprintVault, type FileStamp } from '@core/fingerprint'
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
  /**
   * Last analysis per vault, keyed by a fingerprint of the files' stats. Held
   * in memory only: it is rebuilt in well under a second, and a stale cache on
   * disk is a worse problem than a cold start.
   */
  private cache = new Map<string, { fingerprint: string; analysis: GraphAnalysis }>()

  async scan(rootPath: string, targetStem: string): Promise<BacklinkHit[]> {
    const hits: BacklinkHit[] = []
    await this.walk(rootPath, targetStem, hits)
    return hits
  }

  /** Every markdown file's stats, without reading any of them. */
  private async stamps(rootPath: string): Promise<FileStamp[]> {
    const found: FileStamp[] = []
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
          continue
        }
        if (!entry.isFile() || !/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) continue
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          found.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size })
        } catch {
          // skip unreadable
        }
      }
    }
    await visit(rootPath)
    return found
  }

  /**
   * Read every note, build the vault's wikilink graph, and analyse it — unless
   * nothing has changed since the last time, in which case the cached analysis
   * is returned and not a single note is read. The `stat` walk that decides
   * this is cheap; reading the files is what costs.
   */
  async graph(rootPath: string): Promise<GraphAnalysis> {
    const stamps = await this.stamps(rootPath)
    const fingerprint = fingerprintVault(stamps)
    const cached = this.cache.get(rootPath)
    if (cached?.fingerprint === fingerprint) return cached.analysis

    const files: GraphFile[] = []
    for (const stamp of stamps) {
      try {
        files.push({
          path: stamp.path,
          stem: path.basename(stamp.path).replace(/\.[^.]+$/, ''),
          content: await fs.readFile(stamp.path, 'utf-8'),
          mtimeMs: stamp.mtimeMs
        })
      } catch {
        // vanished between the walk and the read
      }
    }

    // One pass over the vault feeds both the graph and its analysis, so every
    // surface (graph, analytics view, note panel) reads the same numbers.
    const analysis = analyzeGraph(buildGraph(files, rootPath), { now: Date.now() })
    this.cache.set(rootPath, { fingerprint, analysis })
    return analysis
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
