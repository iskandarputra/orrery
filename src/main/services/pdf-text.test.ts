import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PdfTextService } from './pdf-text'
import { makePdf } from './__fixtures__/make-pdf'

/**
 * Driven against real PDFs, built here byte by byte, and read with the same
 * pdf.js the app reads them with. A stub that returned the text the test wanted
 * would prove nothing about the only hard part: getting words out of a format
 * that stores drawing instructions.
 */

let dir: string
let cache: string
let service: PdfTextService

const write = (name: string, pages: string[][]): string => {
  const path = join(dir, name)
  writeFileSync(path, makePdf({ pages }))
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-pdftext-'))
  cache = join(dir, 'cache')
  service = new PdfTextService(cache)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('reading a PDF', () => {
  it('gives back what each page says, in order', async () => {
    const path = write('paper.pdf', [
      ['The first page speaks of kestrels.'],
      ['The second page does not.']
    ])
    const text = await service.read(path)

    expect(text.pages).toHaveLength(2)
    expect(text.pages[0]).toContain('kestrels')
    expect(text.pages[1]).toContain('second page')
  })

  it('keeps the lines of a page apart', async () => {
    const path = write('lines.pdf', [['One line.', 'Another line.']])
    expect((await service.read(path)).pages[0]).toBe('One line.\nAnother line.')
  })

  it('names the pages with no text on them', async () => {
    // A scan is a picture of a page: there is nothing to extract, which is not
    // the same as a document that failed to parse. Naming them is what lets the
    // reader offer to recognise those pages rather than silently returning
    // nothing for them.
    const path = write('mixed.pdf', [['Words here.'], [], ['More words.']])
    expect((await service.read(path)).emptyPages).toEqual([2])
  })

  it('comes back empty for something that is not a PDF at all', async () => {
    // Search walks a whole vault; one bad file must not end the walk.
    const path = join(dir, 'broken.pdf')
    writeFileSync(path, 'this is not a PDF, it is a sentence')
    await expect(service.read(path)).resolves.toEqual({ pages: [], emptyPages: [] })
  })

  it('comes back empty for a file that is not there', async () => {
    await expect(service.read(join(dir, 'gone.pdf'))).resolves.toEqual({
      pages: [],
      emptyPages: []
    })
  })
})

describe('the cache', () => {
  it('writes one entry per document', async () => {
    const path = write('cached.pdf', [['Something to remember.']])
    await service.read(path)
    expect(readdirSync(cache)).toHaveLength(1)
  })

  it('reads a rewritten file again rather than answering from the old text', async () => {
    // Keyed on modification time and size: a file that has been replaced is a
    // different document, and stale text is worse than none.
    const path = write('changing.pdf', [['Before.']])
    expect((await service.read(path)).pages[0]).toContain('Before')

    // A fresh service, so the answer can only come from the cache or the file.
    writeFileSync(path, makePdf({ pages: [['After, and longer than before.']] }))
    expect((await new PdfTextService(cache).read(path)).pages[0]).toContain('After')
  })

  it('answers from the cache rather than reading the file again', async () => {
    const path = write('stable.pdf', [['Unchanged.']])
    const first = await service.read(path)
    const stat = statSync(path)

    // The bytes are replaced with something unparseable, and the modification
    // time and size are put back exactly as they were. A reader that parses the
    // file now gets nothing; only a cache hit can still answer.
    writeFileSync(path, Buffer.alloc(stat.size, 0x20))
    utimesSync(path, stat.atime, stat.mtime)

    expect(await new PdfTextService(cache).read(path)).toEqual(first)
  })

  it('takes text somebody else produced, for the pages that had none', async () => {
    // This is the seam OCR arrives through: the recogniser hands back the pages
    // it read, and everything downstream keeps asking one question.
    const path = write('scan.pdf', [['Real text.'], []])
    await service.read(path)
    const merged = await service.merge(path, new Map([[2, 'recognised words']]))

    expect(merged.pages[1]).toBe('recognised words')
    expect(merged.emptyPages).toEqual([])
    expect((await new PdfTextService(cache).read(path)).pages[1]).toBe('recognised words')
  })

  it('does not parse the same document twice at once', async () => {
    const path = write('busy.pdf', [['Once.']])
    const [a, b] = await Promise.all([service.read(path), service.read(path)])
    expect(a).toEqual(b)
    expect(readdirSync(cache)).toHaveLength(1)
  })
})
