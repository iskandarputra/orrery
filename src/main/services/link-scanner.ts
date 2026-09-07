import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fingerprintVault, type FileStamp } from '@core/fingerprint'
import { buildGraph, type GraphFile } from '@core/graph'
import { importsFamily } from '@core/code-links'
import { matchesAnyGlob, parsePatternList } from '@core/glob'
import { resolve } from '@core/link-resolution'
import { analyzeGraph } from '@core/metrics'
import { buildSearchMatcher, type SearchOptions } from '@core/search-query'
import type { BacklinkHit, GraphAnalysis, GraphEdge } from '@shared/types'
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
 * Reads the vault: backlinks and full-text search, plus the cached graph both
 * of them and the map lean on. Search still walks the filesystem fresh on
 * every call, fast enough for personal-vault sizes; backlinks does not, since
 * `graph` already keeps an analysis behind a fingerprint for the map.
 */
export class LinkScanner {
  /**
   * Last analysis per vault, keyed by a fingerprint of the files' stats. Held
   * in memory only: it is rebuilt in well under a second, and a stale cache on
   * disk is a worse problem than a cold start.
   *
   * One entry per root, and the fingerprint folds in `withCode`. Two callers
   * that disagreed about it would thrash: each call would find the other's
   * entry, see the wrong `withCode` baked into the fingerprint, and rebuild
   * the whole vault, alternating forever. What keeps that from happening is
   * that the MCP tool reads `settings.graph.includeCode` (the same setting
   * the map itself uses) rather than deciding its own; nothing else takes
   * that on faith, and a future caller with its own opinion pays for it here.
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

  /**
   * What links to a file, answered from the graph rather than from a scan.
   *
   * It used to be its own recursive text walk for `[[stem]]` over markdown
   * only, which made it a third answer to a question the map and the editor
   * were already answering two other ways: it never saw an import, so a
   * source file had no backlinks at all, and with two files of the same name
   * it reported both while the map had already picked one of them.
   *
   * `withCode` is the caller's graph setting rather than a decision made
   * here, so the panel and the map describe the same vault. Asking for one
   * while the other is loaded rebuilds, because the two walks read different
   * files.
   */
  async backlinks(rootPath: string, targetPath: string, withCode: boolean): Promise<BacklinkHit[]> {
    const analysis = await this.graph(rootPath, withCode)
    const incoming = analysis.edges.filter(
      (edge) => edge.to === targetPath && edge.from !== targetPath
    )
    if (incoming.length === 0) return []

    // Snippets are read here, not carried on every edge. A 200-character
    // snippet per edge would put megabytes into every graph build and every
    // IPC reply, for text that only ever fills a panel.
    const byFile = new Map<string, GraphEdge[]>()
    for (const edge of incoming.slice(0, MAX_HITS)) {
      const bucket = byFile.get(edge.from)
      if (bucket) bucket.push(edge)
      else byFile.set(edge.from, [edge])
    }

    const hits: BacklinkHit[] = []
    for (const [file, edges] of byFile) {
      let lines: string[]
      try {
        lines = (await fs.readFile(file, 'utf-8')).split('\n')
      } catch {
        continue // vanished since the graph was built
      }
      for (const edge of edges) {
        hits.push({
          path: file,
          line: edge.line,
          snippet: (lines[edge.line - 1] ?? '').trim().slice(0, 200),
          // Only present when true, matching `page`: the panel tells "no
          // choice was made" apart from "a choice was made and this was not
          // it" by whether the property is there at all.
          ...(edge.ambiguous ? { ambiguous: true as const } : {})
        })
      }
    }
    return hits
  }

  /**
   * A note's path, given its name rather than a path.
   *
   * MCP holds a note NAME, not a path: a client asking "what links to X" knows
   * the title, not where the vault keeps it. Candidates go through the same
   * arbiter every other resolver uses, so an agent gets the file the map and
   * the panel would also call X rather than a fourth opinion.
   *
   * `rootPath` stands in for `fromPath`, because there is no file the request
   * was written in to rank folders against. It is a directory, not a file, so
   * `dirname(rootPath)` is the root's own PARENT and no in-vault candidate can
   * ever share that folder, and `sharedFolders` counts one segment short of
   * `rootPath` because it has no trailing filename of its own to set aside.
   * Both proximity tiers are starved by construction, every candidate ties at
   * 0, and the ranking falls straight through to the deterministic
   * shallowest-then-lexicographic tiers, which is the answer this caller wants:
   * one that does not depend on which folder happened to be asked from.
   */
  async findNote(rootPath: string, name: string, withCode: boolean): Promise<string | null> {
    const analysis = await this.graph(rootPath, withCode)
    const candidates = analysis.nodes
      .filter((node) => node.exists && node.label.toLowerCase() === name.toLowerCase())
      .map((node) => node.id)
    const resolution = resolve(rootPath, candidates, {
      tieBreak: 'nearest',
      whenEmpty: { status: 'missing', at: name }
    })
    return resolution.status === 'resolved' ? resolution.to : null
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
  async graph(rootPath: string, withCode: boolean): Promise<GraphAnalysis> {
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
}
