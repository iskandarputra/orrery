import type * as PdfjsApi from 'pdfjs-dist'
import type * as PdfjsViewer from 'pdfjs-dist/web/pdf_viewer.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * pdf.js, fetched the first time a PDF is actually opened.
 *
 * The engine, its worker, the viewer components and their stylesheet come to
 * about a megabyte and a half of JavaScript, and the assets beside them another
 * four. A vault with no PDFs in it should never pay for any of that, so nothing
 * here is imported until a `.pdf` is opened — the same bargain KaTeX, the
 * terminal and Excalidraw already make.
 *
 * The module is remembered, so the wait happens once per session and every PDF
 * after the first opens straight away.
 */

export interface Pdfjs {
  api: typeof PdfjsApi
  viewer: typeof PdfjsViewer
  /** Options every `getDocument` call needs, so no caller has to remember them. */
  documentOptions: {
    cMapUrl: string
    cMapPacked: true
    standardFontDataUrl: string
    wasmUrl: string
    /**
     * A PDF may carry JavaScript. Orrery never runs it: this is a document
     * somebody was sent, and the reader is not a place to execute code from
     * one. Forms still fill in; only their scripting is absent.
     */
    isEvalSupported: false
    enableXfa: false
  }
}

let loaded: Pdfjs | null = null
let loading: Promise<Pdfjs> | null = null

/**
 * Where the copies of pdf.js's own data files live.
 *
 * Beside `index.html`, put there by `scripts/sync-assets.mjs`. Without the
 * character maps a CJK PDF renders blank, and without the standard fonts a
 * document that names Helvetica without embedding it draws nothing — both are
 * silent failures, which is why they are bundled rather than fetched.
 */
function assetBase(): string {
  return new URL('./pdfjs/', window.location.href).href
}

export function loadPdfjs(): Promise<Pdfjs> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= (async () => {
    // The viewer components are built against a `pdfjsLib` global rather than
    // an import of the engine, so the engine has to be there — and assigned —
    // before that module is even evaluated. Loading them together destructures
    // `undefined` and the whole reader fails to start.
    const api = await import('pdfjs-dist')
    ;(globalThis as { pdfjsLib?: typeof api }).pdfjsLib = api
    const [viewer] = await Promise.all([
      import('pdfjs-dist/web/pdf_viewer.mjs'),
      import('pdfjs-dist/web/pdf_viewer.css')
    ])
    // Parsing happens off the UI thread; without this pdf.js runs the whole
    // engine on the main thread and a large page freezes the app while it draws.
    api.GlobalWorkerOptions.workerSrc = workerUrl
    const base = assetBase()
    loaded = {
      api,
      viewer,
      documentOptions: {
        cMapUrl: `${base}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${base}standard_fonts/`,
        wasmUrl: `${base}wasm/`,
        isEvalSupported: false,
        enableXfa: false
      }
    }
    return loaded
  })()
  return loading
}
