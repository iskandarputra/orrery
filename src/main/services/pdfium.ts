import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PagePlan } from '@core/pdf-pages'

/**
 * The engine that writes a PDF's structure.
 *
 * pdf.js reads and can append annotations to what it read; it cannot take a
 * document apart. Rearranging pages means building a new document and importing
 * pages into it, which is what PDFium is for — the same engine Chrome uses,
 * under a BSD licence, as one wasm file in the main process.
 *
 * Loaded on first use and kept: four and a half megabytes that a vault of notes
 * never pays for, and that a session which reorders one document should not pay
 * for twice.
 *
 * Everything here works on bytes and returns bytes. Deciding *what* to do is
 * `core/pdf-pages.ts`, which is pure and tested without an engine at all; this
 * only carries the plan out.
 */

/** The handful of PDFium calls this needs, as the binding exposes them. */
interface Pdfium {
  PDFiumExt_Init?: () => void
  FPDF_LoadMemDocument(data: number, size: number, password: string): number
  FPDF_CreateNewDocument(): number
  FPDF_GetPageCount(doc: number): number
  FPDF_ImportPagesByIndex(
    dest: number,
    src: number,
    indices: number,
    count: number,
    at: number
  ): boolean
  FPDF_LoadPage(doc: number, index: number): number
  FPDFPage_SetRotation(page: number, rotation: number): void
  FPDF_ClosePage(page: number): void
  FPDF_SaveAsCopy(doc: number, writer: number, flags: number): boolean
  FPDF_CloseDocument(doc: number): void
  pdfium: {
    HEAPU8: Uint8Array
    wasmExports: { malloc(size: number): number; free(ptr: number): void }
    addFunction(fn: (...args: number[]) => number, signature: string): number
    removeFunction(ptr: number): void
    setValue(ptr: number, value: number, type: string): void
  }
}

let engine: Promise<Pdfium> | null = null

function load(): Promise<Pdfium> {
  engine ??= (async () => {
    // Resolved through the entry point rather than the package manifest: this
    // package does not export its `package.json`, and the wasm sits beside the
    // module that loads it either way.
    const require = createRequire(__filename)
    const dist = path.dirname(require.resolve('@embedpdf/pdfium'))
    const wasmBinary = await fs.readFile(path.join(dist, 'pdfium.wasm'))
    const { init } = (await import('@embedpdf/pdfium')) as unknown as {
      init(overrides: { wasmBinary: Buffer }): Promise<Pdfium>
    }
    const lib = await init({ wasmBinary })
    // PDFium keeps global state — fonts, the memory allocator — that has to be
    // set up before any document is loaded.
    lib.PDFiumExt_Init?.()
    return lib
  })()
  return engine
}

/** Whether the engine can be loaded at all, for a UI that should not offer what it cannot do. */
export async function pdfiumAvailable(): Promise<boolean> {
  try {
    await load()
    return true
  } catch {
    return false
  }
}

/**
 * Build a new document from these ones, following the plan.
 *
 * `sources` are whole PDFs; the plan's indices run across them in order, so two
 * documents can be merged by numbering the second one's pages from where the
 * first one's stop — which is what `appendPages` produces.
 *
 * A new document rather than an edit in place: this is how PDFium rearranges
 * pages, and it means the original bytes are never modified — the caller writes
 * the result over the file only once it has all of it.
 */
export async function applyPagePlan(
  sources: readonly Uint8Array[],
  plan: PagePlan
): Promise<Uint8Array> {
  const lib = await load()
  const rt = lib.pdfium
  const allocated: number[] = []
  const documents: number[] = []
  let dest = 0
  let writeBlock = 0

  const alloc = (size: number): number => {
    const ptr = rt.wasmExports.malloc(size)
    allocated.push(ptr)
    return ptr
  }

  try {
    // Every source, loaded, with a note of where its pages start in the plan's
    // numbering.
    const loaded: { doc: number; from: number; count: number }[] = []
    let offset = 0
    for (const bytes of sources) {
      const ptr = alloc(bytes.length)
      rt.HEAPU8.set(bytes, ptr)
      const doc = lib.FPDF_LoadMemDocument(ptr, bytes.length, '')
      if (!doc) throw new Error('This PDF could not be opened')
      documents.push(doc)
      const count = lib.FPDF_GetPageCount(doc)
      loaded.push({ doc, from: offset, count })
      offset += count
    }

    dest = lib.FPDF_CreateNewDocument()
    if (!dest) throw new Error('A new document could not be started')

    // Imported in runs: consecutive pages from one source in one call, which is
    // both faster and how PDFium prefers to be asked.
    let at = 0
    for (let i = 0; i < plan.order.length;) {
      const page = plan.order[i]!
      const source = loaded.find((entry) => page >= entry.from && page < entry.from + entry.count)
      if (!source) {
        i++
        continue
      }
      const run: number[] = []
      while (i < plan.order.length) {
        const next = plan.order[i]!
        if (next < source.from || next >= source.from + source.count) break
        run.push(next - source.from)
        i++
      }
      const indices = alloc(run.length * 4)
      run.forEach((index, n) => rt.setValue(indices + n * 4, index, 'i32'))
      if (!lib.FPDF_ImportPagesByIndex(dest, source.doc, indices, run.length, at)) {
        throw new Error('Those pages could not be copied')
      }
      at += run.length
    }

    // Rotation is a quarter-turn count in PDFium, and absolute.
    plan.rotate.forEach((angle, index) => {
      if (angle === 0) return
      const page = lib.FPDF_LoadPage(dest, index)
      if (!page) return
      lib.FPDFPage_SetRotation(page, (((angle / 90) % 4) + 4) % 4)
      lib.FPDF_ClosePage(page)
    })

    // Saving hands bytes back a block at a time through a callback, which is
    // what the `FPDF_FILEWRITE` struct below is: a version, and a function
    // pointer for the engine to call.
    const chunks: Uint8Array[] = []
    writeBlock = rt.addFunction((_self: number, data: number, size: number) => {
      chunks.push(rt.HEAPU8.slice(data, data + size))
      return 1
    }, 'iiii')
    const writer = alloc(8)
    rt.setValue(writer, 1, 'i32')
    rt.setValue(writer + 4, writeBlock, 'i32')
    if (!lib.FPDF_SaveAsCopy(dest, writer, 0)) throw new Error('The document could not be written')

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let cursor = 0
    for (const chunk of chunks) {
      out.set(chunk, cursor)
      cursor += chunk.length
    }
    if (out.length === 0) throw new Error('The document came back empty')
    return out
  } finally {
    // Wasm memory is not garbage collected: a document left open is megabytes
    // held for the life of the process, and this runs however the attempt ended.
    if (dest) lib.FPDF_CloseDocument(dest)
    for (const doc of documents) lib.FPDF_CloseDocument(doc)
    if (writeBlock) rt.removeFunction(writeBlock)
    for (const ptr of allocated) rt.wasmExports.free(ptr)
  }
}
