/**
 * Reading a page that has no text on it.
 *
 * A scanned document is a picture of writing: the words are visible and there
 * is nothing to select, search or quote. Recognition is what turns it back into
 * a document, and it is the difference between a folder of scans being part of
 * a knowledge base and being a shelf of images.
 *
 * Tesseract, its wasm engine and the English training data are all fetched from
 * a CDN by default — three ways for an offline app to fail — so all three are
 * bundled beside `index.html` and pointed at here. Nothing loads until somebody
 * asks for a page to be read: about seven megabytes that most vaults never
 * touch.
 */

/** The subset of tesseract.js this uses. */
interface Worker {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>
  terminate(): Promise<void>
}

interface Tesseract {
  createWorker(language: string, oem?: number, options?: Record<string, unknown>): Promise<Worker>
}

function assetBase(): string {
  return new URL('./tesseract/', window.location.href).href
}

let engine: Promise<Tesseract> | null = null

function load(): Promise<Tesseract> {
  engine ??= import('tesseract.js') as unknown as Promise<Tesseract>
  return engine
}

/**
 * A worker, ready to read pages.
 *
 * One per run rather than one per page: starting a worker means loading the
 * engine and the language data, which is most of the time a short document
 * takes.
 */
export async function startReader(onProgress?: (fraction: number) => void): Promise<Worker> {
  const tesseract = await load()
  const base = assetBase()
  return tesseract.createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    // Named exactly, so nothing is chosen at runtime and nothing is fetched
    // from a CDN when the choice cannot be satisfied locally.
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base,
    // The bundled data is gzipped, as it is shipped.
    gzip: true,
    // Load the worker from the file beside index.html rather than wrapping it
    // in a blob, which is what this does by default. The app's policy allows
    // scripts from itself and not from `blob:`, and widening that to run
    // script assembled at runtime is a poor trade for saving one fetch of a
    // file that is already local.
    workerBlobURL: false,
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status === 'recognizing text') onProgress?.(message.progress ?? 0)
    }
  })
}

/**
 * Read one rendered page.
 *
 * The caller draws the page — at a scale it chooses, since recognition wants
 * more pixels than reading does — and this turns that picture into text.
 */
export async function readPage(worker: Worker, canvas: HTMLCanvasElement): Promise<string> {
  try {
    const { data } = await worker.recognize(canvas)
    return data.text.trim()
  } catch {
    // A page that will not read is a page with no text, which is what it was
    // before anyone asked.
    return ''
  }
}
