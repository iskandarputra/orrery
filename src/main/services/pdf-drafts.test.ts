import { describe, expect, it, vi } from 'vitest'
import { PdfDrafts } from './pdf-drafts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array): string => new TextDecoder().decode(data)

describe('PdfDrafts', () => {
  it('reads the file until something has changed', async () => {
    const drafts = new PdfDrafts()
    const fromDisk = vi.fn(async () => bytes('on disk'))

    expect(text(await drafts.read('/a.pdf', fromDisk))).toBe('on disk')
    expect(drafts.has('/a.pdf')).toBe(false)

    drafts.set('/a.pdf', bytes('edited'))
    expect(text(await drafts.read('/a.pdf', fromDisk))).toBe('edited')
    expect(drafts.has('/a.pdf')).toBe(true)
    // The point of the whole thing: the file was never asked about again, and
    // nothing has been written to it.
    expect(fromDisk).toHaveBeenCalledTimes(1)
  })

  it('lands a second change on top of the first, not on the file', async () => {
    const drafts = new PdfDrafts()
    const fromDisk = async (): Promise<Uint8Array> => bytes('one')

    drafts.set('/a.pdf', bytes(`${text(await drafts.read('/a.pdf', fromDisk))} two`))
    drafts.set('/a.pdf', bytes(`${text(await drafts.read('/a.pdf', fromDisk))} three`))

    expect(text(await drafts.read('/a.pdf', fromDisk))).toBe('one two three')
  })

  it('keeps one document apart from another', async () => {
    const drafts = new PdfDrafts()
    const fromDisk = async (file: string): Promise<Uint8Array> => bytes(`disk:${file}`)

    drafts.set('/a.pdf', bytes('edited a'))

    expect(text(await drafts.read('/a.pdf', fromDisk))).toBe('edited a')
    expect(text(await drafts.read('/b.pdf', fromDisk))).toBe('disk:/b.pdf')
    expect(drafts.peek('/b.pdf')).toBeUndefined()
  })

  it('goes back to the file once the draft is discarded', async () => {
    const drafts = new PdfDrafts()
    const fromDisk = async (): Promise<Uint8Array> => bytes('on disk')

    drafts.set('/a.pdf', bytes('never saved'))
    drafts.discard('/a.pdf')

    // What closing a tab without saving has to mean: the change is gone, and
    // opening the file again shows what was actually written.
    expect(drafts.has('/a.pdf')).toBe(false)
    expect(text(await drafts.read('/a.pdf', fromDisk))).toBe('on disk')
  })

  it('hands the protocol the bytes to serve, and nothing for an untouched file', () => {
    const drafts = new PdfDrafts()
    drafts.set('/a.pdf', bytes('edited'))

    expect(text(drafts.peek('/a.pdf')!)).toBe('edited')
    expect(drafts.peek('/untouched.pdf')).toBeUndefined()
  })
})
