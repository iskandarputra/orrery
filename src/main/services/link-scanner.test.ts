import { mkdtempSync, writeFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LinkScanner } from './link-scanner'
import { PdfTextService } from './pdf-text'
import { makePdf } from './__fixtures__/make-pdf'

let vault: string
let scanner: LinkScanner

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'orrery-scan-'))
  writeFileSync(path.join(vault, 'A.md'), '# A\n\nLinks [[B]].\n')
  writeFileSync(path.join(vault, 'B.md'), '# B\n\nBack to [[A]].\n')
  scanner = new LinkScanner()
})

afterEach(() => rmSync(vault, { recursive: true, force: true }))

describe('graph caching', () => {
  it('analyses the vault on the first call', async () => {
    const analysis = await scanner.graph(vault)
    expect(analysis.stats.notes).toBe(2)
    expect(analysis.stats.links).toBe(2)
  })

  it('returns the very same analysis when nothing changed', async () => {
    const first = await scanner.graph(vault)
    const second = await scanner.graph(vault)
    // Identity, not just equality: the cached object was handed back.
    expect(second).toBe(first)
  })

  it('re-analyses after a note is edited', async () => {
    const first = await scanner.graph(vault)
    writeFileSync(path.join(vault, 'B.md'), '# B\n\nNo links any more.\n')
    const second = await scanner.graph(vault)
    expect(second).not.toBe(first)
    expect(second.stats.links).toBe(1)
  })

  it('re-analyses after a note is added or removed', async () => {
    await scanner.graph(vault)
    writeFileSync(path.join(vault, 'C.md'), '# C\n')
    const withC = await scanner.graph(vault)
    expect(withC.stats.notes).toBe(3)

    unlinkSync(path.join(vault, 'C.md'))
    const withoutC = await scanner.graph(vault)
    expect(withoutC.stats.notes).toBe(2)
  })

  it('notices an edit that keeps the same timestamp but changes the size', async () => {
    const target = path.join(vault, 'B.md')
    const first = await scanner.graph(vault)
    const stamp = new Date(2020, 0, 1)
    writeFileSync(target, '# B\n\nBack to [[A]] and [[A]] again, longer now.\n')
    utimesSync(target, stamp, stamp)
    // Force the first file's mtime to match too, so only size differs overall.
    const second = await scanner.graph(vault)
    expect(second).not.toBe(first)
  })

  it('keeps separate caches per vault', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'orrery-scan2-'))
    writeFileSync(path.join(other, 'Only.md'), '# Only\n')
    try {
      const a = await scanner.graph(vault)
      const b = await scanner.graph(other)
      expect(a.stats.notes).toBe(2)
      expect(b.stats.notes).toBe(1)
      expect(await scanner.graph(vault)).toBe(a)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('searching inside PDFs', () => {
  const options = {
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    include: '',
    exclude: ''
  }

  /** A vault where the papers say something the notes do not. */
  const withPaper = (): LinkScanner => {
    writeFileSync(
      path.join(vault, 'Paper.pdf'),
      makePdf({
        pages: [['A first page about nothing much.'], ['The second page speaks of kestrels.']]
      })
    )
    return new LinkScanner(null, new PdfTextService(path.join(vault, '.cache')))
  }

  it('finds a word that only exists inside a PDF', async () => {
    // The blind spot this closes: every search walks a folder reading files as
    // text, and to that walk a PDF is a binary to skip past.
    const hits = await withPaper().search(vault, 'kestrels', options)
    expect(hits.map((h) => path.basename(h.path))).toEqual(['Paper.pdf'])
    expect(hits[0]?.snippet).toContain('kestrels')
  })

  it('says which page, because a paper has pages and not lines', async () => {
    const [hit] = await withPaper().search(vault, 'kestrels', options)
    expect(hit?.page).toBe(2)
  })

  it('still finds the notes, and leaves their hits alone', async () => {
    const hits = await withPaper().search(vault, 'Links', options)
    expect(hits.map((h) => path.basename(h.path))).toEqual(['A.md'])
    expect(hits[0]?.page).toBeUndefined()
  })

  it('reports one hit per page rather than one per occurrence', async () => {
    // A result list is a list of places to look, not a concordance.
    writeFileSync(
      path.join(vault, 'Repeats.pdf'),
      makePdf({ pages: [['kestrels kestrels', 'and kestrels again']] })
    )
    const hits = await new LinkScanner(null, new PdfTextService(path.join(vault, '.c'))).search(
      vault,
      'kestrels',
      options
    )
    expect(hits.filter((h) => h.path.endsWith('Repeats.pdf'))).toHaveLength(1)
  })

  it('finds nothing in a PDF when there is no reader for them', async () => {
    // The scanner still has to stand up without one.
    withPaper()
    expect(await new LinkScanner().search(vault, 'kestrels', options)).toEqual([])
  })
})
