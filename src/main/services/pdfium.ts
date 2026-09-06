import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PageObject } from '@core/pdf-edit'
import { rotationAbout } from '@core/pdf-geometry'
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
  FPDFPage_CountObjects(page: number): number
  FPDFPage_GetObject(page: number, index: number): number
  FPDFPage_RemoveObject(page: number, object: number): boolean
  FPDFPage_GenerateContent(page: number): boolean
  FPDFPageObj_GetType(object: number): number
  FPDFPageObj_GetBounds(
    object: number,
    left: number,
    bottom: number,
    right: number,
    top: number
  ): boolean
  FPDFPageObj_Destroy(object: number): void
  FPDFText_LoadPage(page: number): number
  FPDFText_ClosePage(textPage: number): void
  FPDFTextObj_GetText(object: number, textPage: number, buffer: number, length: number): number
  FPDFText_SetText(object: number, text: number): boolean
  FPDFPageObj_Transform(
    object: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): void
  FPDFPageObj_CreateTextObj(doc: number, font: number, size: number): number
  /** The binding declares the name as a string and marshals it itself. */
  FPDFText_LoadStandardFont(doc: number, name: string): number
  FPDFFont_Close(font: number): void
  FPDFPage_InsertObject(page: number, object: number): void
  FPDFPageObj_NewImageObj(doc: number): number
  FPDFImageObj_SetBitmap(pages: number, count: number, object: number, bitmap: number): boolean
  FPDFImageObj_SetMatrix(
    object: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): boolean
  FPDFBitmap_CreateEx(
    width: number,
    height: number,
    format: number,
    buffer: number,
    stride: number
  ): number
  FPDFBitmap_Destroy(bitmap: number): void
  FPDFPageObj_SetFillColor(object: number, r: number, g: number, b: number, a: number): boolean
  pdfium: {
    HEAPU8: Uint8Array
    UTF16ToString(ptr: number): string
    stringToUTF16(text: string, ptr: number, max: number): void
    getValue(ptr: number, type: string): number
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

/** PDFium's object types. Only text is editable here; the rest can be removed. */
const OBJECT_KINDS: Record<number, string> = {
  1: 'text',
  2: 'path',
  3: 'image',
  4: 'shading',
  5: 'form'
}

/**
 * Everything drawn on one page, with where it sits and what it says.
 *
 * This is what makes editing possible at all: a click on a rendered page means
 * nothing until it can be turned into "the third object on page two", and only
 * the engine that will do the editing can number them.
 */
export async function pageObjects(bytes: Uint8Array, pageIndex: number): Promise<PageObject[]> {
  return withPage(bytes, pageIndex, (lib, page) => {
    const rt = lib.pdfium
    const textPage = lib.FPDFText_LoadPage(page)
    const box = rt.wasmExports.malloc(16)
    try {
      const found: PageObject[] = []
      const count = lib.FPDFPage_CountObjects(page)
      for (let index = 0; index < count; index++) {
        const object = lib.FPDFPage_GetObject(page, index)
        if (!object) continue
        const type = lib.FPDFPageObj_GetType(object)
        lib.FPDFPageObj_GetBounds(object, box, box + 4, box + 8, box + 12)
        let text = ''
        if (type === 1 && textPage) {
          const needed = lib.FPDFTextObj_GetText(object, textPage, 0, 0)
          if (needed > 0) {
            const buffer = rt.wasmExports.malloc(needed)
            lib.FPDFTextObj_GetText(object, textPage, buffer, needed)
            text = rt.UTF16ToString(buffer)
            rt.wasmExports.free(buffer)
          }
        }
        found.push({
          index,
          kind: OBJECT_KINDS[type] ?? 'other',
          bounds: {
            left: rt.getValue(box, 'float'),
            bottom: rt.getValue(box + 4, 'float'),
            right: rt.getValue(box + 8, 'float'),
            top: rt.getValue(box + 12, 'float')
          },
          text
        })
      }
      return found
    } finally {
      rt.wasmExports.free(box)
      if (textPage) lib.FPDFText_ClosePage(textPage)
    }
  })
}

/**
 * Retype a line, however many objects it turned out to be made of.
 *
 * The new text goes on the first object — which keeps the line's font, size and
 * starting position — and the rest of the objects are removed. A page that
 * positioned every character separately becomes one that positions the line,
 * which is what retyping it means: the same words in the same place, laid out
 * by the font's own advances rather than by the original's per-character
 * nudges.
 *
 * The consequence is worth knowing and is the reason this is not silent about
 * it elsewhere: a line rebuilt this way is spaced by its font rather than by
 * whatever the producer chose, so a heavily kerned line will shift a little.
 */
export async function editTextRun(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndexes: readonly number[],
  text: string
): Promise<Uint8Array> {
  const [first, ...rest] = [...objectIndexes].sort((a, b) => a - b)
  if (first === undefined) throw new Error('There is nothing there to retype')

  return writeWithPage(bytes, pageIndex, (lib, page) => {
    const rt = lib.pdfium
    const object = lib.FPDFPage_GetObject(page, first)
    if (!object) throw new Error('That object is no longer there')
    if (lib.FPDFPageObj_GetType(object) !== 1) throw new Error('That is not text')

    const size = (text.length + 1) * 2
    const buffer = rt.wasmExports.malloc(size)
    try {
      rt.stringToUTF16(text, buffer, size)
      if (!lib.FPDFText_SetText(object, buffer)) throw new Error('The text could not be replaced')
    } finally {
      rt.wasmExports.free(buffer)
    }

    // Back to front: removing an object renumbers the ones after it.
    for (const index of [...rest].sort((a, b) => b - a)) {
      const extra = lib.FPDFPage_GetObject(page, index)
      if (!extra) continue
      if (lib.FPDFPage_RemoveObject(page, extra)) lib.FPDFPageObj_Destroy(extra)
    }
    if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
  })
}

/**
 * Take objects off a page and out of the file.
 *
 * Removed rather than covered, which is the whole difference between redaction
 * and a black rectangle: a covered word is still in the document for anyone who
 * selects the text or reads the bytes.
 *
 * Removed from the end backwards, because removing an object renumbers the ones
 * after it.
 */
export async function removePageObjects(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndexes: readonly number[]
): Promise<Uint8Array> {
  const going = [...new Set(objectIndexes)].sort((a, b) => b - a)
  return writeWithPage(bytes, pageIndex, (lib, page) => {
    for (const index of going) {
      const object = lib.FPDFPage_GetObject(page, index)
      if (!object) continue
      if (!lib.FPDFPage_RemoveObject(page, object)) continue
      // Removing detaches it; destroying it is what frees it.
      lib.FPDFPageObj_Destroy(object)
    }
    if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
  })
}

/** Open a document, hand one page to the caller, and clean up afterwards. */
async function withPage<T>(
  bytes: Uint8Array,
  pageIndex: number,
  body: (lib: Pdfium, page: number) => T
): Promise<T> {
  const lib = await load()
  const rt = lib.pdfium
  const ptr = rt.wasmExports.malloc(bytes.length)
  rt.HEAPU8.set(bytes, ptr)
  const doc = lib.FPDF_LoadMemDocument(ptr, bytes.length, '')
  if (!doc) {
    rt.wasmExports.free(ptr)
    throw new Error('This PDF could not be opened')
  }
  const page = lib.FPDF_LoadPage(doc, pageIndex)
  try {
    if (!page) throw new Error('That page is not in this document')
    return body(lib, page)
  } finally {
    if (page) lib.FPDF_ClosePage(page)
    lib.FPDF_CloseDocument(doc)
    rt.wasmExports.free(ptr)
  }
}

/** The same, but saving the document afterwards and returning its bytes. */
async function writeWithPage(
  bytes: Uint8Array,
  pageIndex: number,
  body: (lib: Pdfium, page: number, doc: number) => void
): Promise<Uint8Array> {
  const lib = await load()
  const rt = lib.pdfium
  const ptr = rt.wasmExports.malloc(bytes.length)
  rt.HEAPU8.set(bytes, ptr)
  const doc = lib.FPDF_LoadMemDocument(ptr, bytes.length, '')
  if (!doc) {
    rt.wasmExports.free(ptr)
    throw new Error('This PDF could not be opened')
  }
  let page = 0
  let writeBlock = 0
  const writer = rt.wasmExports.malloc(8)
  try {
    page = lib.FPDF_LoadPage(doc, pageIndex)
    if (!page) throw new Error('That page is not in this document')
    body(lib, page, doc)

    const chunks: Uint8Array[] = []
    writeBlock = rt.addFunction((_self: number, data: number, size: number) => {
      chunks.push(rt.HEAPU8.slice(data, data + size))
      return 1
    }, 'iiii')
    rt.setValue(writer, 1, 'i32')
    rt.setValue(writer + 4, writeBlock, 'i32')
    if (!lib.FPDF_SaveAsCopy(doc, writer, 0)) throw new Error('The document could not be written')

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (total === 0) throw new Error('The document came back empty')
    const out = new Uint8Array(total)
    let cursor = 0
    for (const chunk of chunks) {
      out.set(chunk, cursor)
      cursor += chunk.length
    }
    return out
  } finally {
    if (page) lib.FPDF_ClosePage(page)
    lib.FPDF_CloseDocument(doc)
    if (writeBlock) rt.removeFunction(writeBlock)
    rt.wasmExports.free(writer)
    rt.wasmExports.free(ptr)
  }
}

/**
 * Move an object, without changing anything else about it.
 *
 * A translation only: the same glyphs, the same size, somewhere else on the
 * page. Dragging a picture into place is the other half of what people mean by
 * editing a PDF, and the half that cannot be done by retyping.
 */
export async function moveObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  dx: number,
  dy: number
): Promise<Uint8Array> {
  return writeWithPage(bytes, pageIndex, (lib, page) => {
    const object = lib.FPDFPage_GetObject(page, objectIndex)
    if (!object) throw new Error('That object is no longer there')
    // The identity matrix with a displacement: [1 0 0 1 dx dy].
    lib.FPDFPageObj_Transform(object, 1, 0, 0, 1, dx, dy)
    if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
  })
}

/**
 * Put new text on a page, in one of the fonts every PDF reader has.
 *
 * A standard font rather than one of the document's own: the document's fonts
 * are usually subsets containing only the characters already on the page, so
 * new words written in one would come out full of holes. Helvetica is one of
 * the fourteen a reader must provide, so this text draws anywhere.
 */
export async function addTextObject(
  bytes: Uint8Array,
  pageIndex: number,
  text: string,
  x: number,
  y: number,
  size: number
): Promise<Uint8Array> {
  return writeWithPage(bytes, pageIndex, (lib, page, doc) => {
    const rt = lib.pdfium
    let font = 0
    let object = 0
    try {
      font = lib.FPDFText_LoadStandardFont(doc, 'Helvetica')
      if (!font) throw new Error('That font could not be loaded')
      object = lib.FPDFPageObj_CreateTextObj(doc, font, size)
      if (!object) throw new Error('The text could not be created')

      const wide = rt.wasmExports.malloc((text.length + 1) * 2)
      try {
        rt.stringToUTF16(text, wide, (text.length + 1) * 2)
        if (!lib.FPDFText_SetText(object, wide)) throw new Error('The text could not be set')
      } finally {
        rt.wasmExports.free(wide)
      }

      // Black, and where it was asked for. A new object starts at the origin.
      lib.FPDFPageObj_SetFillColor(object, 0, 0, 0, 255)
      lib.FPDFPageObj_Transform(object, 1, 0, 0, 1, x, y)
      lib.FPDFPage_InsertObject(page, object)
      object = 0 // the page owns it now
      if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
    } finally {
      if (object) lib.FPDFPageObj_Destroy(object)
      if (font) lib.FPDFFont_Close(font)
    }
  })
}

/**
 * Make an object bigger or smaller, about its own bottom-left corner.
 *
 * Scaling a page object means multiplying its matrix, and a bare scale would
 * move it as well as resize it — everything is measured from the page's corner,
 * so doubling an object's size doubles its distance from that corner too. The
 * matrix here scales in place: shift the corner to the origin, scale, shift it
 * back, which is what dragging a handle is understood to mean.
 */
/**
 * Turn an object about its own middle.
 *
 * The angle is absolute nowhere — PDFium has no notion of "this object is at
 * 30 degrees", only a matrix that has been applied to it — so this turns by
 * however much is asked for, from wherever it is now. That is also what the
 * handle in the editor does, so the two agree.
 */
export async function rotateObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  degrees: number
): Promise<Uint8Array> {
  return writeWithPage(bytes, pageIndex, (lib, page) => {
    const rt = lib.pdfium
    const object = lib.FPDFPage_GetObject(page, objectIndex)
    if (!object) throw new Error('That object is no longer there')

    const box = rt.wasmExports.malloc(16)
    try {
      lib.FPDFPageObj_GetBounds(object, box, box + 4, box + 8, box + 12)
      const left = rt.getValue(box, 'float')
      const bottom = rt.getValue(box + 4, 'float')
      const right = rt.getValue(box + 8, 'float')
      const top = rt.getValue(box + 12, 'float')
      const [a, b, c, d, e, f] = rotationAbout(degrees, {
        x: (left + right) / 2,
        y: (bottom + top) / 2
      })
      lib.FPDFPageObj_Transform(object, a, b, c, d, e, f)
    } finally {
      rt.wasmExports.free(box)
    }
    if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
  })
}

export async function resizeObject(
  bytes: Uint8Array,
  pageIndex: number,
  objectIndex: number,
  sx: number,
  sy: number
): Promise<Uint8Array> {
  if (!(sx > 0) || !(sy > 0)) throw new Error('An object cannot be scaled to nothing')
  return writeWithPage(bytes, pageIndex, (lib, page) => {
    const rt = lib.pdfium
    const object = lib.FPDFPage_GetObject(page, objectIndex)
    if (!object) throw new Error('That object is no longer there')

    const box = rt.wasmExports.malloc(16)
    try {
      lib.FPDFPageObj_GetBounds(object, box, box + 4, box + 8, box + 12)
      const left = rt.getValue(box, 'float')
      const bottom = rt.getValue(box + 4, 'float')
      lib.FPDFPageObj_Transform(object, sx, 0, 0, sy, left * (1 - sx), bottom * (1 - sy))
    } finally {
      rt.wasmExports.free(box)
    }
    if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
  })
}

/** How many pages a document has, without drawing any of them. */
export async function pageCount(bytes: Uint8Array): Promise<number> {
  const lib = await load()
  const rt = lib.pdfium
  const ptr = rt.wasmExports.malloc(bytes.length)
  rt.HEAPU8.set(bytes, ptr)
  const doc = lib.FPDF_LoadMemDocument(ptr, bytes.length, '')
  try {
    if (!doc) throw new Error('This PDF could not be opened')
    return lib.FPDF_GetPageCount(doc)
  } finally {
    if (doc) lib.FPDF_CloseDocument(doc)
    rt.wasmExports.free(ptr)
  }
}

/** PDFium's BGRA bitmap format, which is what Electron decodes an image into. */
const BGRA = 4

/**
 * Put a picture on a page.
 *
 * The image arrives already decoded — main has Electron's own decoder, which
 * reads every format the app can show — so this only has to hand PDFium the
 * pixels and say where they go.
 *
 * A page object rather than an annotation: it becomes part of the page like the
 * words around it, it is undone by the same undo, and every reader draws it,
 * including the ones that ignore annotations.
 */
export async function addImageObject(
  bytes: Uint8Array,
  pageIndex: number,
  image: { pixels: Uint8Array; width: number; height: number },
  x: number,
  y: number,
  drawWidth: number,
  drawHeight: number
): Promise<Uint8Array> {
  if (image.width < 1 || image.height < 1) throw new Error('That image has no size')

  return writeWithPage(bytes, pageIndex, (lib, page, doc) => {
    const rt = lib.pdfium
    const stride = image.width * 4
    let pixels = 0
    let bitmap = 0
    let object = 0
    try {
      pixels = rt.wasmExports.malloc(stride * image.height)
      rt.HEAPU8.set(image.pixels.subarray(0, stride * image.height), pixels)
      bitmap = lib.FPDFBitmap_CreateEx(image.width, image.height, BGRA, pixels, stride)
      if (!bitmap) throw new Error('That image could not be prepared')

      object = lib.FPDFPageObj_NewImageObj(doc)
      if (!object) throw new Error('That image could not be added')
      if (!lib.FPDFImageObj_SetBitmap(0, 0, object, bitmap)) {
        throw new Error('That image could not be drawn')
      }
      // An image object is drawn into the unit square, so its matrix *is* its
      // size and position on the page.
      lib.FPDFImageObj_SetMatrix(object, drawWidth, 0, 0, drawHeight, x, y)
      lib.FPDFPage_InsertObject(page, object)
      object = 0 // the page owns it now
      if (!lib.FPDFPage_GenerateContent(page)) throw new Error('The page could not be redrawn')
    } finally {
      if (object) lib.FPDFPageObj_Destroy(object)
      if (bitmap) lib.FPDFBitmap_Destroy(bitmap)
      // Freed after the bitmap, which was reading these pixels.
      if (pixels) rt.wasmExports.free(pixels)
    }
  })
}
