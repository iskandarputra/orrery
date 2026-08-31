import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fingerprintVault, type FileStamp } from '@core/fingerprint'
import { buildGraph, type GraphFile } from '@core/graph'
import { importsFamily } from '@core/code-links'
import { matchesAnyGlob, parsePatternList } from '@core/glob'
import { analyzeGraph } from '@core/metrics'
import { buildSearchMatcher, type SearchOptions } from '@core/search-query'
import { findLinkLines } from '@core/wikilinks'
import type { BacklinkHit, GraphAnalysis } from '@shared/types'
import type { SidecarClient } from './sidecar'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])

/**
 * Skipped when the graph walks source files, and only then.
 *
 * Build output is code the vault did not write, and a map of it is a picture
 * of a bundler rather than of a project. Search still looks in these, because
 * someone typing `path:dist` is asking for exactly that.
 */
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** A document with pages, read by the PDF reader rather than as text. */
const isPdf = (name: string): boolean => /\.pdf$/i.test(name)
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
  constructor(
    private readonly sidecar: SidecarClient | null = null,
    /**
     * What the vault's PDFs say, when there is anything to ask.
     *
     * Optional so the scanner still stands up in a test without one — but with
     * it, a search covers the papers as well as the notes, which is the whole
     * reason a knowledge base should be able to open a PDF at all.
     */
    private readonly pdfText: { read(path: string): Promise<{ pages: string[] }> } | null = null
  ) {}

  async scan(rootPath: string, targetStem: string): Promise<BacklinkHit[]> {
    const hits: BacklinkHit[] = []
    await this.walk(rootPath, targetStem, hits)
    return hits
  }

  /** Every markdown file's stats, without reading any of them. */
  private async stamps(rootPath: string, withCode = false): Promise<FileStamp[]> {
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
        if (withCode && BUILD_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await visit(full)
          continue
        }
        if (!entry.isFile()) continue
        // Notes always; source files when the graph is asked to include them.
        const markdown = /\.(md|markdown|mdown|mkd)$/i.test(entry.name)
        if (!markdown && !(withCode && importsFamily(entry.name))) continue
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
  /**
   * The vault's graph.
   *
   * `withCode` widens the walk from markdown to source files, so imports join
   * the wikilinks. It is part of the cache key rather than a filter afterwards:
   * the two walks read different files, and answering one from the other's
   * cache would show a map with half of itself missing.
   */
  async graph(rootPath: string, withCode = false): Promise<GraphAnalysis> {
    const stamps = await this.stamps(rootPath, withCode)
    const fingerprint = `${withCode ? 'code:' : 'notes:'}${fingerprintVault(stamps)}`
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
    const matcher = buildSearchMatcher(query, options)
    if (!matcher) return []

    // PDFs are searched here whichever path finds the text files: the sidecar
    // walks a folder reading files as text, and to it a PDF is a binary it
    // skips — which is exactly the blind spot this is closing.
    const inPdfs = await this.searchPdfs(rootPath, matcher, options)

    const offloaded = await this.searchViaSidecar(rootPath, query, options)
    // The sidecar reads files as text too, so its PDF hits are the same
    // nonsense and are dropped for the real ones.
    if (offloaded) {
      return [...offloaded.filter((hit) => !isPdf(hit.path)), ...inPdfs].slice(0, MAX_HITS)
    }

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
        // A PDF is searched by what it says, not by what its bytes spell. Read
        // as text, one with uncompressed streams matches on words buried in
        // drawing instructions and reports them as lines of a file nobody can
        // open at a line — and the same document is searched properly below.
        if (isPdf(entry.name)) continue
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
    return [...hits, ...inPdfs].slice(0, MAX_HITS)
  }

  /**
   * The same query, against what the vault's PDFs say.
   *
   * A hit's `page` is what a PDF has instead of a line, and it is carried
   * separately rather than squeezed into `line`: opening a result means opening
   * a document at a page, and a reader that jumped to "line 34" of a paper
   * would be guessing.
   *
   * Only PDFs already read are cheap here; the rest are parsed on the first
   * search that reaches them and cached from then on.
   */
  private async searchPdfs(
    rootPath: string,
    matcher: RegExp,
    options: { include: string; exclude: string }
  ): Promise<BacklinkHit[]> {
    if (!this.pdfText) return []
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
          if (exclude.length > 0 && matchesAnyGlob(relative + '/', exclude)) continue
          await visit(full)
          continue
        }
        if (!entry.isFile() || !isPdf(entry.name)) continue
        if (include.length > 0 && !matchesAnyGlob(relative, include)) continue
        if (exclude.length > 0 && matchesAnyGlob(relative, exclude)) continue

        const { pages } = await this.pdfText!.read(full)
        for (let index = 0; index < pages.length && hits.length < MAX_HITS; index++) {
          for (const line of pages[index]!.split('\n')) {
            matcher.lastIndex = 0
            if (!matcher.test(line)) continue
            hits.push({
              path: full,
              // A page, not a line — and `line` is what every caller reads, so
              // it carries the page and `page` says that is what it is.
              line: index + 1,
              page: index + 1,
              snippet: line.trim().slice(0, 200)
            })
            break // one hit per page: a result list is not a concordance
          }
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
