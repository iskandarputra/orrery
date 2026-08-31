import { describe, expect, it } from 'vitest'
import {
  appendPages,
  extractPages,
  initialPlan,
  movePages,
  removePages,
  rotatePages
} from '@core/pdf-pages'
import {
  addImageObject,
  addTextObject,
  applyPagePlan,
  editTextRun,
  moveObject,
  pageCount,
  pageObjects,
  removePageObjects,
  resizeObject
} from './pdfium'
import { groupTargets } from '@core/pdf-edit'
import { makePdf } from './__fixtures__/make-pdf'

/**
 * The write engine, checked by reading its output with the other one.
 *
 * PDFium writes and pdf.js reads, and they share no code — so what these assert
 * is not "PDFium thinks it did the right thing" but "an independent
 * implementation sees the document we meant to make". That is the strongest
 * cheap guarantee available for a format this fiddly, and it is why the two
 * engines are worth having.
 */

const doc = (...pages: string[]): Uint8Array =>
  new Uint8Array(makePdf({ pages: pages.map((line) => [line]) }))

/** What pdf.js makes of some bytes: the text of each page, and its rotation. */
async function readBack(bytes: Uint8Array): Promise<{ text: string; rotate: number }[]> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument(options: unknown): { promise: Promise<PdfjsDoc> }
  }
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  const pages: { text: string; rotate: number }[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    pages.push({
      text: content.items
        .map((item) => item.str)
        .join(' ')
        .trim(),
      rotate: page.rotate
    })
  }
  return pages
}

interface PdfjsDoc {
  numPages: number
  getPage(n: number): Promise<{
    rotate: number
    getTextContent(): Promise<{ items: { str: string }[] }>
  }>
}

describe('applying a page plan', () => {
  it('leaves a document alone when the plan changes nothing', async () => {
    const out = await applyPagePlan([doc('one', 'two')], initialPlan(2))
    expect((await readBack(out)).map((p) => p.text)).toEqual(['one', 'two'])
  })

  it('reorders the pages', async () => {
    const plan = movePages(initialPlan(3), [2], 0)
    const out = await applyPagePlan([doc('one', 'two', 'three')], plan)
    expect((await readBack(out)).map((p) => p.text)).toEqual(['three', 'one', 'two'])
  })

  it('removes a page, and the rest keep their contents', async () => {
    const out = await applyPagePlan([doc('one', 'two', 'three')], removePages(initialPlan(3), [1]))
    expect((await readBack(out)).map((p) => p.text)).toEqual(['one', 'three'])
  })

  it('turns a page, and only that page', async () => {
    const out = await applyPagePlan([doc('one', 'two')], rotatePages(initialPlan(2), [0], 90))
    expect((await readBack(out)).map((p) => p.rotate)).toEqual([90, 0])
  })

  it('extracts a page into a document of its own', async () => {
    const out = await applyPagePlan([doc('one', 'two', 'three')], extractPages(initialPlan(3), [1]))
    expect((await readBack(out)).map((p) => p.text)).toEqual(['two'])
  })

  it('merges two documents in one pass', async () => {
    const plan = appendPages(initialPlan(2), 1, 2)
    const out = await applyPagePlan([doc('one', 'two'), doc('appended')], plan)
    expect((await readBack(out)).map((p) => p.text)).toEqual(['one', 'two', 'appended'])
  })

  it('refuses bytes that are not a PDF rather than writing nonsense', async () => {
    const rubbish = new Uint8Array(Buffer.from('not a PDF at all'))
    await expect(applyPagePlan([rubbish], initialPlan(1))).rejects.toThrow()
  })

  it('survives being asked over and over, without leaking the engine', async () => {
    // Wasm memory is not garbage collected: a document left open is megabytes
    // held for the life of the process.
    for (let i = 0; i < 12; i++) {
      const out = await applyPagePlan([doc('one', 'two')], movePages(initialPlan(2), [1], 0))
      expect((await readBack(out))[0]?.text).toBe('two')
    }
  })
})

describe('editing what is on a page', () => {
  it('lists what is drawn, with what it says and where it sits', async () => {
    const objects = await pageObjects(doc('hello there'), 0)
    expect(objects).toHaveLength(1)
    expect(objects[0]?.kind).toBe('text')
    expect(objects[0]?.text).toBe('hello there')
    expect(objects[0]?.bounds.left).toBeGreaterThan(0)
    expect(objects[0]?.bounds.top).toBeGreaterThan(objects[0]!.bounds.bottom)
  })

  it('retypes a line in place, and the other engine reads the new words', async () => {
    const out = await editTextRun(doc('the original line'), 0, [0], 'the replacement line')
    expect((await readBack(out)).map((p) => p.text)).toEqual(['the replacement line'])
  })

  it('leaves everything else on the page alone', async () => {
    const source = new Uint8Array(makePdf({ pages: [['first line', 'second line', 'third line']] }))
    const out = await editTextRun(source, 0, [1], 'CHANGED')
    const text = (await readBack(out))[0]?.text ?? ''
    expect(text).toContain('first line')
    expect(text).toContain('CHANGED')
    expect(text).toContain('third line')
    expect(text).not.toContain('second line')
  })

  it('takes an object out of the file rather than covering it', async () => {
    // The whole difference between redaction and a black rectangle: a covered
    // word is still in the document for anyone who selects the text.
    const source = new Uint8Array(makePdf({ pages: [['keep me', 'remove me']] }))
    const out = await removePageObjects(source, 0, [1])
    const text = (await readBack(out))[0]?.text ?? ''
    expect(text).toContain('keep me')
    expect(text).not.toContain('remove me')
  })

  it('removes several at once, without the renumbering losing one', async () => {
    // Removing an object renumbers the ones after it, so the order matters.
    const source = new Uint8Array(makePdf({ pages: [['one', 'two', 'three', 'four']] }))
    const out = await removePageObjects(source, 0, [0, 2])
    const text = (await readBack(out))[0]?.text ?? ''
    expect(text).toContain('two')
    expect(text).toContain('four')
    expect(text).not.toContain('one')
    expect(text).not.toContain('three')
  })

  it('refuses to retype something that is not text', async () => {
    const source = new Uint8Array(makePdf({ pages: [['words']] }))
    await expect(editTextRun(source, 0, [99], 'nope')).rejects.toThrow()
  })
})

describe('moving and adding', () => {
  it('moves an object without changing what it says', async () => {
    const source = new Uint8Array(makePdf({ pages: [['a line to shift']] }))
    const [before] = await pageObjects(source, 0)
    const out = await moveObject(source, 0, 0, 40, -30)

    const [after] = await pageObjects(out, 0)
    expect(after?.text).toBe('a line to shift')
    expect(after!.bounds.left).toBeCloseTo(before!.bounds.left + 40, 0)
    expect(after!.bounds.top).toBeCloseTo(before!.bounds.top - 30, 0)
    // And the other engine still reads it.
    expect((await readBack(out))[0]?.text).toContain('a line to shift')
  })

  it('puts new text on a page, where it was asked for', async () => {
    const out = await addTextObject(
      new Uint8Array(makePdf({ pages: [['existing']] })),
      0,
      'added words',
      100,
      400,
      14
    )
    const objects = await pageObjects(out, 0)
    expect(objects).toHaveLength(2)
    const added = objects.find((o) => o.text === 'added words')
    expect(added).toBeTruthy()
    expect(added!.bounds.left).toBeCloseTo(100, -1)
    expect((await readBack(out))[0]?.text).toContain('added words')
  })

  it('writes new text in a font every reader has', async () => {
    // The document's own fonts are usually subsets holding only the characters
    // already on the page, so new words written in one come out full of holes.
    const out = await addTextObject(
      new Uint8Array(makePdf({ pages: [['abc']] })),
      0,
      'Zyxw £ 42',
      72,
      500,
      12
    )
    expect((await readBack(out))[0]?.text).toContain('Zyxw')
  })
})

describe('resizing', () => {
  it('makes an object bigger without moving its corner', async () => {
    // A bare scale would move it as well: everything is measured from the
    // page's corner, so doubling a size doubles the distance to it too.
    const source = new Uint8Array(makePdf({ pages: [['a line to stretch']] }))
    const [before] = await pageObjects(source, 0)
    const out = await resizeObject(source, 0, 0, 2, 2)

    const [after] = await pageObjects(out, 0)
    expect(after!.bounds.left).toBeCloseTo(before!.bounds.left, 0)
    expect(after!.bounds.bottom).toBeCloseTo(before!.bounds.bottom, 0)
    const wide = before!.bounds.right - before!.bounds.left
    expect(after!.bounds.right - after!.bounds.left).toBeCloseTo(wide * 2, 0)
    expect((await readBack(out))[0]?.text).toContain('a line to stretch')
  })

  it('refuses to scale something out of existence', async () => {
    const source = new Uint8Array(makePdf({ pages: [['x']] }))
    await expect(resizeObject(source, 0, 0, 0, 1)).rejects.toThrow()
    await expect(resizeObject(source, 0, 0, 1, -2)).rejects.toThrow()
  })
})

describe('counting pages', () => {
  it('says how many there are', async () => {
    expect(await pageCount(new Uint8Array(makePdf({ pages: [['a'], ['b'], ['c']] })))).toBe(3)
  })

  it('refuses something that is not a PDF', async () => {
    await expect(pageCount(new Uint8Array(Buffer.from('nope')))).rejects.toThrow()
  })
})

describe('editing a line made of many objects', () => {
  /** A page that positions every character separately, as real PDFs do. */
  const perCharacter = (word: string): Uint8Array =>
    new Uint8Array(makePdf({ pages: [[...word].map((c) => c)] }))

  it('retypes the whole line and leaves one object behind', async () => {
    // The case real documents are full of: 4,662 single-glyph objects on a
    // page, where editing one at a time means retyping single letters.
    const source = perCharacter('ABC')
    const objects = await pageObjects(source, 0)
    expect(objects).toHaveLength(3)

    const out = await editTextRun(
      source,
      0,
      objects.map((o) => o.index),
      'REPLACED'
    )
    const after = await pageObjects(out, 0)
    expect(after).toHaveLength(1)
    expect(after[0]?.text).toBe('REPLACED')
    expect((await readBack(out))[0]?.text).toBe('REPLACED')
  })

  it('leaves the objects it was not given alone', async () => {
    const source = new Uint8Array(makePdf({ pages: [['keep this', 'A', 'B']] }))
    const objects = await pageObjects(source, 0)
    const run = objects.filter((o) => o.text === 'A' || o.text === 'B').map((o) => o.index)

    const out = await editTextRun(source, 0, run, 'joined')
    const text = (await readBack(out))[0]?.text ?? ''
    expect(text).toContain('keep this')
    expect(text).toContain('joined')
  })

  it('refuses an empty run rather than writing nothing', async () => {
    await expect(editTextRun(perCharacter('AB'), 0, [], 'x')).rejects.toThrow()
  })
})

describe('a document that positions every character', () => {
  it('is what the fixture can now produce', async () => {
    // The shape of a real PDF: one text object per glyph, so a line of ten
    // letters is ten objects.
    const source = new Uint8Array(makePdf({ pages: [['LETTER OF OFFER']], perCharacter: true }))
    const objects = await pageObjects(source, 0)
    expect(objects).toHaveLength('LETTER OF OFFER'.length)
    // A glyph each — sometimes with a trailing space the engine infers from the
    // gap to the next one, which is what it reports for real documents too.
    expect(objects.every((o) => o.text.trim().length <= 1)).toBe(true)
    expect(objects.some((o) => o.text.includes('LETTER'))).toBe(false)
  })

  it('groups back into one line, and retypes as one', async () => {
    const source = new Uint8Array(makePdf({ pages: [['RENT']], perCharacter: true }))
    const targets = groupTargets(await pageObjects(source, 0), { width: 612, height: 792 })
    expect(targets).toHaveLength(1)
    expect(targets[0]?.text).toBe('RENT')

    const out = await editTextRun(source, 0, targets[0]!.indexes, 'LEASE')
    expect((await readBack(out))[0]?.text).toBe('LEASE')
  })
})

describe('putting a picture on a page', () => {
  /** Sixteen pixels of solid blue, as BGRA — what a decoder hands over. */
  const blue = (): { pixels: Uint8Array; width: number; height: number } => {
    const width = 4
    const height = 4
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200 // blue
      pixels[i + 1] = 40
      pixels[i + 2] = 20
      pixels[i + 3] = 255
    }
    return { pixels, width, height }
  }

  it('adds an image object where it was asked for', async () => {
    const source = new Uint8Array(makePdf({ pages: [['a page with words']] }))
    const out = await addImageObject(source, 0, blue(), 100, 300, 80, 60)

    const objects = await pageObjects(out, 0)
    const picture = objects.find((o) => o.kind === 'image')
    expect(picture).toBeTruthy()
    expect(picture!.bounds.left).toBeCloseTo(100, -1)
    expect(picture!.bounds.right - picture!.bounds.left).toBeCloseTo(80, -1)
    expect(picture!.bounds.top - picture!.bounds.bottom).toBeCloseTo(60, -1)
  })

  it('leaves the words that were already there', async () => {
    const source = new Uint8Array(makePdf({ pages: [['a page with words']] }))
    const out = await addImageObject(source, 0, blue(), 10, 10, 40, 40)
    expect((await readBack(out))[0]?.text).toContain('a page with words')
  })

  it('refuses an image with no pixels rather than writing a broken one', async () => {
    const source = new Uint8Array(makePdf({ pages: [['x']] }))
    await expect(
      addImageObject(source, 0, { pixels: new Uint8Array(0), width: 0, height: 0 }, 0, 0, 10, 10)
    ).rejects.toThrow()
  })
})
