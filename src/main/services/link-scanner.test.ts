import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
  utimesSync
} from 'node:fs'
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
    const analysis = await scanner.graph(vault, false)
    expect(analysis.stats.notes).toBe(2)
    expect(analysis.stats.links).toBe(2)
  })

  it('returns the very same analysis when nothing changed', async () => {
    const first = await scanner.graph(vault, false)
    const second = await scanner.graph(vault, false)
    // Identity, not just equality: the cached object was handed back.
    expect(second).toBe(first)
  })

  it('re-analyses after a note is edited', async () => {
    const first = await scanner.graph(vault, false)
    writeFileSync(path.join(vault, 'B.md'), '# B\n\nNo links any more.\n')
    const second = await scanner.graph(vault, false)
    expect(second).not.toBe(first)
    expect(second.stats.links).toBe(1)
  })

  it('re-analyses after a note is added or removed', async () => {
    await scanner.graph(vault, false)
    writeFileSync(path.join(vault, 'C.md'), '# C\n')
    const withC = await scanner.graph(vault, false)
    expect(withC.stats.notes).toBe(3)

    unlinkSync(path.join(vault, 'C.md'))
    const withoutC = await scanner.graph(vault, false)
    expect(withoutC.stats.notes).toBe(2)
  })

  it('notices an edit that keeps the same timestamp but changes the size', async () => {
    const target = path.join(vault, 'B.md')
    const first = await scanner.graph(vault, false)
    const stamp = new Date(2020, 0, 1)
    writeFileSync(target, '# B\n\nBack to [[A]] and [[A]] again, longer now.\n')
    utimesSync(target, stamp, stamp)
    // Force the first file's mtime to match too, so only size differs overall.
    const second = await scanner.graph(vault, false)
    expect(second).not.toBe(first)
  })

  it('keeps separate caches per vault', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'orrery-scan2-'))
    writeFileSync(path.join(other, 'Only.md'), '# Only\n')
    try {
      const a = await scanner.graph(vault, false)
      const b = await scanner.graph(other, false)
      expect(a.stats.notes).toBe(2)
      expect(b.stats.notes).toBe(1)
      expect(await scanner.graph(vault, false)).toBe(a)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('graph walk order', () => {
  /** The order a one-file-at-a-time walk visits notes in: readdir order, depth first. */
  function serialOrder(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...serialOrder(full))
      else if (entry.name.endsWith('.md')) out.push(full)
    }
    return out
  }

  it('keeps the order of a serial walk, however the reads finish', async () => {
    // Node order is what pivots and tie-breaks in the analysis go by, so a walk
    // that collected files as their stats came back would recolour the map on
    // every scan. Big files in shallow folders and small ones deep down make
    // completion order and walk order disagree if anything is left to chance.
    for (let d = 0; d < 6; d++) {
      const deep = path.join(vault, `d${d}`, 'x', 'y')
      mkdirSync(deep, { recursive: true })
      for (let i = 0; i < 8; i++) {
        writeFileSync(path.join(vault, `d${d}`, `big${i}.md`), `[[A]] ${'word '.repeat(40000)}`)
        writeFileSync(path.join(deep, `n${d}-${i}.md`), `[[B]]`)
      }
    }
    const analysis = await scanner.graph(vault, false)
    const files = analysis.nodes.filter((n) => n.exists).map((n) => n.id)
    expect(files).toEqual(serialOrder(vault))
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

describe('backlinks from the graph', () => {
  it('finds a wikilink and an import pointing at the same file', () => {
    writeFileSync(path.join(vault, 'note.md'), 'see [[helper]]\n')
    writeFileSync(path.join(vault, 'helper.ts'), 'export const helper = 1\n')
    writeFileSync(path.join(vault, 'app.ts'), "import { helper } from './helper'\n")
    return scanner.backlinks(vault, path.join(vault, 'helper.ts'), true).then((hits) => {
      expect(hits.map((h) => path.basename(h.path)).sort()).toEqual(['app.ts', 'note.md'])
      expect(hits.find((h) => h.path.endsWith('app.ts'))).toMatchObject({
        line: 1,
        snippet: "import { helper } from './helper'"
      })
    })
  })

  it('does not report the file linking to itself', async () => {
    writeFileSync(path.join(vault, 'self.md'), 'see [[self]] and [[B]]\n')
    const hits = await scanner.backlinks(vault, path.join(vault, 'self.md'), false)
    expect(hits).toEqual([])
  })

  it('leaves source files out when the graph is set to notes only', async () => {
    writeFileSync(path.join(vault, 'helper.ts'), 'export const helper = 1\n')
    writeFileSync(path.join(vault, 'app.ts'), "import { helper } from './helper'\n")
    const hits = await scanner.backlinks(vault, path.join(vault, 'helper.ts'), false)
    expect(hits).toEqual([])
  })

  it('marks a hit ambiguous when its edge picked between two candidates', async () => {
    // Two `Store.md`, so `[[Store]]` has somewhere else it could have meant.
    // `Note.md` sits next to the root one, which wins on folder, but the
    // choice still happened and the hit for it should say so.
    mkdirSync(path.join(vault, 'Deep'))
    writeFileSync(path.join(vault, 'Store.md'), '# Store\n')
    writeFileSync(path.join(vault, 'Deep', 'Store.md'), '# Store\n')
    writeFileSync(path.join(vault, 'Note.md'), 'see [[Store]]\n')

    const ambiguous = await scanner.backlinks(vault, path.join(vault, 'Store.md'), false)
    const hit = ambiguous.find((h) => h.path.endsWith('Note.md'))
    expect(hit?.ambiguous).toBe(true)

    // A.md's [[B]] has exactly one B.md to mean: no choice, so no flag at all,
    // not a flag set to false. Absence is how the panel tells the two apart.
    const unambiguous = await scanner.backlinks(vault, path.join(vault, 'B.md'), false)
    expect(unambiguous).toHaveLength(1)
    expect(unambiguous[0]?.ambiguous).toBeUndefined()
  })
})

describe('findNote', () => {
  it('resolves a bare name to the note the graph already knows', async () => {
    const found = await scanner.findNote(vault, 'A', false)
    expect(found).toBe(path.join(vault, 'A.md'))
  })

  it('returns null for a name with no file', async () => {
    const found = await scanner.findNote(vault, 'Nowhere', false)
    expect(found).toBeNull()
  })
})
