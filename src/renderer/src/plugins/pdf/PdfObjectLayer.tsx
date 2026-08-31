import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { missingGlyphs, objectAt, type PageObject } from '@core/pdf-edit'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'

/**
 * Editing what is actually drawn on the page.
 *
 * Everything else in this reader adds to a document: an annotation sits on top
 * of the page, and the page underneath is untouched. This changes the page —
 * retypes a line in its own font, at its own position, or takes something out
 * of the file altogether.
 *
 * The two honest limits are enforced here rather than discovered later. A PDF
 * has no paragraphs, so a longer line runs on past where the old one ended
 * instead of reflowing what follows. And most documents embed only the glyphs
 * they use, so a character the document has never drawn probably cannot be
 * drawn: typing one is allowed, but not without being told.
 */

/** A box over each object, and the input that replaces one when it is picked. */
export function PdfObjectLayer({
  doc,
  path,
  page,
  alphabet,
  mtime,
  onChanged
}: {
  doc: PDFDocumentProxy
  path: string
  /** 1-based, as the reader counts. */
  page: number
  /** Everything this document says, for guessing what its fonts can draw. */
  alphabet: string
  mtime: number | null
  onChanged: (mtimeMs: number) => void
}): React.JSX.Element | null {
  const [objects, setObjects] = useState<PageObject[]>([])
  const [geometry, setGeometry] = useState<{
    scale: number
    height: number
    /** Where the drawn page sits inside the scroller, so the layer can sit on it. */
    left: number
    top: number
    width: number
  } | null>(null)
  const [picked, setPicked] = useState<PageObject | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * Characters the document has never drawn, once somebody has typed one.
   *
   * Shown in the box rather than in a dialog: a modal here would take the
   * keyboard away mid-edit, and the answer is one somebody can give by pressing
   * the same key again.
   */
  const [warned, setWarned] = useState<string[]>([])

  // What is on this page, and how its coordinates map to the drawn one.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [found, pdfPage] = await Promise.all([
          invoke('pdf:objects', { path, page: page - 1 }),
          doc.getPage(page)
        ])
        if (!live) return
        const view = pdfPage.view as number[]
        const width = (view[2] ?? 0) - (view[0] ?? 0)
        const height = (view[3] ?? 0) - (view[1] ?? 0)
        const drawn = document.querySelector<HTMLElement>(
          `.pdfViewer .page[data-page-number="${page}"]`
        )
        if (!drawn) return
        const scale = width > 0 ? drawn.clientWidth / width : 1
        setObjects(found)
        setGeometry({
          scale,
          height,
          left: drawn.offsetLeft,
          top: drawn.offsetTop,
          width: drawn.clientWidth
        })
      } catch {
        if (live) setObjects([])
      }
    })()
    return () => {
      live = false
    }
  }, [doc, path, page])

  if (!geometry || objects.length === 0) return null

  /** PDF space has its origin at the bottom left; the page on screen does not. */
  const box = (object: PageObject): React.CSSProperties => ({
    left: object.bounds.left * geometry.scale,
    top: (geometry.height - object.bounds.top) * geometry.scale,
    width: Math.max(2, (object.bounds.right - object.bounds.left) * geometry.scale),
    height: Math.max(2, (object.bounds.top - object.bounds.bottom) * geometry.scale)
  })

  const apply = async (): Promise<void> => {
    if (!picked || busy) return
    // Warn once, then take the same keystroke as the answer. Refusing outright
    // would be wrong — the font may well have the glyph — and asking silently
    // is how somebody ends up with a line that is missing three letters.
    const missing = missingGlyphs(alphabet, draft)
    if (missing.length > 0 && warned.join('') !== missing.join('')) {
      setWarned(missing)
      return
    }
    setBusy(true)
    try {
      const result = await invoke('pdf:editObject', {
        path,
        page: page - 1,
        index: picked.index,
        text: draft,
        expectedMtimeMs: mtime
      })
      setPicked(null)
      onChanged(result.mtimeMs)
    } catch {
      useStore.getState().showToast('That text could not be changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (object: PageObject): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await invoke('pdf:removeObjects', {
        path,
        page: page - 1,
        indexes: [object.index],
        expectedMtimeMs: mtime
      })
      setPicked(null)
      onChanged(result.mtimeMs)
    } catch {
      useStore.getState().showToast('That could not be removed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="pdfv__objects"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height * geometry.scale
      }}
      onClick={(event) => {
        // A click anywhere on the page picks whatever is smallest under it,
        // which is how you get the words rather than the box behind them.
        const host = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - host.left) / geometry.scale
        const y = geometry.height - (event.clientY - host.top) / geometry.scale
        const hit = objectAt(objects, x, y)
        setPicked(hit)
        setDraft(hit?.text ?? '')
      }}
    >
      {objects.map((object) => (
        <div
          key={object.index}
          className={`pdfv__object${picked?.index === object.index ? ' pdfv__object--picked' : ''}`}
          style={box(object)}
          title={object.kind === 'text' ? object.text : object.kind}
        />
      ))}

      {picked && (
        <div className="pdfv__object-edit" style={box(picked)} onClick={(e) => e.stopPropagation()}>
          {picked.kind === 'text' ? (
            <input
              className="pdfv__object-input"
              aria-label="Replace this text"
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value)
                setWarned([])
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void apply()
                else if (e.key === 'Escape') setPicked(null)
              }}
            />
          ) : (
            <span className="pdfv__object-kind">{picked.kind}</span>
          )}
          <button
            className="pdfv__action"
            aria-label="Remove this from the page"
            title="Take this out of the document"
            disabled={busy}
            onClick={() => void remove(picked)}
          >
            ✕
          </button>
        </div>
      )}

      {picked && warned.length > 0 && (
        <p
          className="pdfv__object-warning"
          role="status"
          style={{
            left: picked.bounds.left * geometry.scale,
            top: (geometry.height - picked.bounds.bottom) * geometry.scale + 4
          }}
        >
          This document has never drawn {warned.join(' ')}, so its font may have no glyph for{' '}
          {warned.length === 1 ? 'it' : 'them'}. Press Enter again to change it anyway.
        </p>
      )}
    </div>
  )
}
