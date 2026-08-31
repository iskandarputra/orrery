import { describe, expect, it } from 'vitest'
import {
  appendPages,
  extractPages,
  initialPlan,
  movePages,
  removePages,
  rotatePages
} from '@core/pdf-pages'
import { applyPagePlan } from './pdfium'
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
