import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fingerprintVault, type FileStamp } from '@core/fingerprint'
import { buildGraph, type GraphFile } from '@core/graph'
import { matchesAnyGlob, parsePatternList } from '@core/glob'
import { analyzeGraph } from '@core/metrics'
import { buildSearchMatcher, type SearchOptions } from '@core/search-query'
import { findLinkLines } from '@core/wikilinks'
import type { BacklinkHit, GraphAnalysis } from '@shared/types'
import type { SidecarClient } from './sidecar'

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

  /**
   * Optional Rust sidecar. Search is the one method hot enough to be worth
   * handing off — a 3,000-note vault takes ~540ms here and ~34ms there — but it
   * is strictly an optimisation: when the sidecar is absent, disabled or slow,
   * `search` runs the TypeScript below and nobody can tell.
   */
  constructor(private readonly sidecar: SidecarClient | null = null) {}

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

  /**
   * Full-text search across the vault.
   *
   * Every text file, not only markdown: the vault is a folder, and since it can
   * hold code the search that cannot see it is the wrong search. Binary files
   * are skipped by looking for a NUL byte rather than by extension, because an
   * extension list is a guess that is wrong for exactly the files people care
   * about.
   */
  async search(
    rootPath: string,
    query: string,
    options: SearchOptions & { include: string; exclude: string }
  ): Promise<BacklinkHit[]> {
    const offloaded = await this.searchViaSidecar(rootPath, query, options)
    if (offloaded) return offloaded

    const matcher = buildSearchMatcher(query, options)
    if (!matcher) return []

    const include = parsePatternList(options.include)
    const exclude = parsePatternList(options.exclude)

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
        const relative = path.relative(rootPath, full).split(path.sep).join('/')

        if (entry.isDirectory()) {
          // Excluding a directory prunes the walk rather than filtering its
          // files one by one, which is the difference between skipping `dist`
          // and reading all of it first.
          if (exclude.length > 0 && matchesAnyGlob(relative + '/', exclude)) continue
          await visit(full)
          continue
        }
        if (!entry.isFile()) continue
        if (include.length > 0 && !matchesAnyGlob(relative, include)) continue
        if (exclude.length > 0 && matchesAnyGlob(relative, exclude)) continue

        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          const text = await fs.readFile(full, 'utf-8')
          if (text.includes('\u0000')) continue // binary
          const lines = text.split('\n')
          for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
            matcher.lastIndex = 0
            if (matcher.test(lines[i]!)) {
              hits.push({ path: full, line: i + 1, snippet: lines[i]!.trim().slice(0, 200) })
            }
          }
        } catch {
          // unreadable — skip
        }
      }
    }
    await visit(rootPath)
    return hits
  }

  /**
   * Ask the sidecar, or return null to mean "use the TypeScript path".
   *
   * The result is validated rather than trusted: a sidecar built from a
   * different revision could return a shape this version does not expect, and
   * falling back is always safe.
   */
  private async searchViaSidecar(
    rootPath: string,
    query: string,
    options: SearchOptions & { include: string; exclude: string }
  ): Promise<BacklinkHit[] | null> {
    if (!this.sidecar?.available) return null
    const result = await this.sidecar.call('search', {
      root_path: rootPath,
      query,
      use_regex: options.regex,
      case_sensitive: options.caseSensitive,
      whole_word: options.wholeWord,
      include: options.include,
      exclude: options.exclude
    })
    if (!Array.isArray(result)) return null
    const hits = result as BacklinkHit[]
    const shaped = hits.every(
      (h) =>
        typeof h?.path === 'string' && typeof h?.line === 'number' && typeof h?.snippet === 'string'
    )
    return shaped ? hits : null
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
