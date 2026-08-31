import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PdfHistory } from './pdf-history'

let dir: string
let history: PdfHistory
const doc = '/vault/paper.pdf'
const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text))
const text = (data: Uint8Array | null): string => (data ? Buffer.from(data).toString() : '')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-pdfhist-'))
  history = new PdfHistory(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('going back', () => {
  it('has nothing to undo before anything has happened', async () => {
    expect(history.can(doc)).toEqual({ undo: false, redo: false })
    expect(await history.undo(doc, bytes('now'))).toBeNull()
  })

  it('gives back what the document was', async () => {
    await history.remember(doc, bytes('first'))
    expect(history.can(doc).undo).toBe(true)
    expect(text(await history.undo(doc, bytes('second')))).toBe('first')
  })

  it('walks back through several changes, most recent first', async () => {
    await history.remember(doc, bytes('one'))
    await history.remember(doc, bytes('two'))
    expect(text(await history.undo(doc, bytes('three')))).toBe('two')
    expect(text(await history.undo(doc, bytes('two')))).toBe('one')
    expect(history.can(doc).undo).toBe(false)
  })
})

describe('going forward again', () => {
  it('redoes what was undone', async () => {
    await history.remember(doc, bytes('before'))
    const undone = await history.undo(doc, bytes('after'))
    expect(text(undone)).toBe('before')
    expect(history.can(doc).redo).toBe(true)
    expect(text(await history.redo(doc, bytes('before')))).toBe('after')
  })

  it('drops the future once a new change is made', async () => {
    // The branch you undid your way out of is not somewhere you can get back
    // to once you have gone somewhere else, which is what every undo does.
    await history.remember(doc, bytes('one'))
    await history.undo(doc, bytes('two'))
    expect(history.can(doc).redo).toBe(true)

    await history.remember(doc, bytes('different'))
    expect(history.can(doc).redo).toBe(false)
  })
})

describe('keeping it bounded', () => {
  it('forgets the oldest steps rather than growing without limit', async () => {
    for (let i = 0; i < 30; i++) await history.remember(doc, bytes(`step ${i}`))
    const kept = readdirSync(join(dir, readdirSync(dir)[0]!)).length
    expect(kept).toBeLessThanOrEqual(20)

    // And what is kept is the recent end: the first undo is the last change.
    expect(text(await history.undo(doc, bytes('now')))).toBe('step 29')
  })

  it('keeps documents apart', async () => {
    await history.remember(doc, bytes('paper'))
    await history.remember('/vault/other.pdf', bytes('other'))
    expect(text(await history.undo('/vault/other.pdf', bytes('x')))).toBe('other')
    expect(text(await history.undo(doc, bytes('x')))).toBe('paper')
  })

  it("throws a document's history away when asked", async () => {
    await history.remember(doc, bytes('one'))
    await history.forget(doc)
    expect(history.can(doc)).toEqual({ undo: false, redo: false })
    expect(await history.undo(doc, bytes('now'))).toBeNull()
  })
})
