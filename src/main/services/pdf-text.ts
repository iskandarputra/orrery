import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pageText, type TextItem } from '@core/pdf-text'

/**
 * What a PDF says, so the vault can see inside it.
 *
 * A PDF is the one document a knowledge base usually cannot search: the words
 * are there, but they are drawn rather than written, and every tool that walks
 * a folder reading files as text skips straight past them. This reads them once
 * with pdf.js and keeps what it found, so search, backlinks and the AI panel
 * can treat a paper like any other document.
 *
 * In the main process rather than in the window, because search runs here and
 * has to work for every PDF in a vault — not only the ones somebody has
 * happened to open.
 *
 * Best-effort throughout. A PDF that will not parse, a cache that will not
 * write, a page that throws halfway: all of them come back as less text, never
 * as a failed search.
 */

/** Bumped when the shape below changes, so old entries are re-read, not misread. */
const CACHE_VERSION = 1

/** Beyond this a document is not searched but skimmed: the first pages only. */
const MAX_PAGES = 2000

export interface PdfText {
  /** One entry per page, in order; empty for a page with no text on it. */
  pages: string[]
  /**
   * Pages that came back empty, 1-based.
   *
   * A scan is a picture of a page and has no text at all, which is not the same
   * as a document that failed to parse. Naming the pages is what lets the
   * reader offer to recognise them rather than quietly returning nothing.
   */
  emptyPages: number[]
}

interface CacheEntry extends PdfText {
  version: number
  mtimeMs: number
  size: number
}

export class PdfTextService {
  /** In-flight reads, so two searches over one vault do not parse everything twice. */
  private readonly pending = new Map<string, Promise<PdfText>>()

  constructor(private readonly cacheDir: string) {}

  /**
   * The text of a PDF, from the cache when it is still good.
   *
   * Keyed by size and modification time as well as path: a file that has been
   * rewritten is a different document, and returning the old text for it would
   * be worse than returning none.
   */
  async read(filePath: string): Promise<PdfText> {
    const existing = this.pending.get(filePath)
    if (existing) return existing

    const job = this.readOnce(filePath).finally(() => this.pending.delete(filePath))
    this.pending.set(filePath, job)
    return job
  }

  /** Forget what was cached for a file, so the next read parses it again. */
  async forget(filePath: string): Promise<void> {
    try {
      await fs.rm(this.cachePath(filePath), { force: true })
    } catch {
      // A cache that will not clear is a cache that will be replaced anyway.
    }
  }

  /**
   * Store text somebody else produced — the OCR of a scanned page.
   *
   * Written into the same cache the extractor fills, so everything downstream
   * asks one question and does not care which answer it is getting.
   */
  async merge(filePath: string, pages: Map<number, string>): Promise<PdfText> {
    const current = await this.read(filePath)
    const merged = current.pages.map((text, index) => pages.get(index + 1) ?? text)
    const result: PdfText = {
      pages: merged,
      emptyPages: merged.map((_, i) => i + 1).filter((page) => merged[page - 1]!.trim() === '')
    }
    await this.write(filePath, result)
    return result
  }

  private async readOnce(filePath: string): Promise<PdfText> {
    let stat: { mtimeMs: number; size: number }
    try {
      stat = await fs.stat(filePath)
    } catch {
      return { pages: [], emptyPages: [] }
    }

    const cached = await this.readCache(filePath)
    // A millisecond of slack on the timestamp, as the save path already allows:
    // modification times survive a round trip through the filesystem at
    // different precisions on different platforms, and exact equality on a
    // float turns "unchanged" into "parse it all again" for no reason.
    if (cached && Math.abs(cached.mtimeMs - stat.mtimeMs) <= 1 && cached.size === stat.size) {
      return { pages: cached.pages, emptyPages: cached.emptyPages }
    }

    const extracted = await this.extract(filePath)
    await this.write(filePath, extracted)
    return extracted
  }

  private async extract(filePath: string): Promise<PdfText> {
    try {
      const pdfjs = await loadPdfjs()
      const data = new Uint8Array(await fs.readFile(filePath))
      const task = pdfjs.getDocument({
        data,
        // The window is not involved, so nothing here should try to draw:
        // extraction wants the text and none of the pictures.
        cMapUrl: assetPath('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: assetPath('standard_fonts'),
        isEvalSupported: false
      })
      const doc = await task.promise
      const pages: string[] = []
      try {
        const count = Math.min(doc.numPages, MAX_PAGES)
        for (let number = 1; number <= count; number++) {
          try {
            const page = await doc.getPage(number)
            const content = await page.getTextContent()
            pages.push(pageText(content.items as TextItem[]))
            page.cleanup()
          } catch {
            // One unreadable page is one empty page, not an unreadable document.
            pages.push('')
          }
        }
      } finally {
        await task.destroy()
      }
      return {
        pages,
        emptyPages: pages.map((_, i) => i + 1).filter((page) => pages[page - 1]!.trim() === '')
      }
    } catch {
      return { pages: [], emptyPages: [] }
    }
  }

  private cachePath(filePath: string): string {
    const key = createHash('sha256').update(filePath).digest('hex').slice(0, 32)
    return path.join(this.cacheDir, `${key}.json`)
  }

  private async readCache(filePath: string): Promise<CacheEntry | null> {
    try {
      const raw = await fs.readFile(this.cachePath(filePath), 'utf-8')
      const entry = JSON.parse(raw) as CacheEntry
      if (entry?.version !== CACHE_VERSION || !Array.isArray(entry.pages)) return null
      return { ...entry, emptyPages: entry.emptyPages ?? [] }
    } catch {
      return null
    }
  }

  private async write(filePath: string, text: PdfText): Promise<void> {
    try {
      const stat = await fs.stat(filePath)
      const entry: CacheEntry = {
        version: CACHE_VERSION,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        ...text
      }
      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.writeFile(this.cachePath(filePath), JSON.stringify(entry))
    } catch {
      // Caching is an optimisation. Failing to cache costs time, not text.
    }
  }
}

/** The pdf.js API, as it looks from Node. Narrow on purpose. */
interface NodePdfjs {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{
      numPages: number
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: unknown[] }>
        cleanup(): void
      }>
    }>
    destroy(): Promise<void>
  }
}

let pdfjs: Promise<NodePdfjs> | null = null

/**
 * The build of pdf.js meant for Node, loaded on first use.
 *
 * `legacy` rather than the modern build: this one runs in the main process,
 * which is Node and not a browser, and the modern build assumes browser globals
 * that are not all there.
 */
function loadPdfjs(): Promise<NodePdfjs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<NodePdfjs>
  return pdfjs
}

/**
 * pdf.js's own data files, read from the installed package.
 *
 * Character maps decide whether a CJK document comes back as text or as
 * nothing, so the path matters even when no page is ever drawn. It is a
 * directory URL because that is the shape pdf.js expects, trailing slash and
 * all.
 */
function assetPath(directory: string): string {
  try {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    return `${path.join(root, directory)}${path.sep}`
  } catch {
    return ''
  }
}
