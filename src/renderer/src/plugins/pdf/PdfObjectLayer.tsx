import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { groupTargets, missingGlyphs, objectAt, type EditTarget } from '@core/pdf-edit'
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
  /**
   * What can be edited, as lines rather than as objects.
   *
   * Most PDFs position every character separately — one page of a real letter
   * held 4,662 text objects, one glyph each — so the objects are put back into
   * lines before anybody is shown them. Without it the page is four thousand
   * boxes and the most you can retype is a letter.
   */
  const [objects, setObjects] = useState<EditTarget[]>([])
  const [geometry, setGeometry] = useState<{
    scale: number
    height: number
    /** Where the drawn page sits inside the scroller, so the layer can sit on it. */
    left: number
    top: number
    width: number
  } | null>(null)
  const [picked, setPicked] = useState<EditTarget | null>(null)
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
  /** A drag in progress: which object, and how far it has come, in CSS pixels. */
  const [dragging, setDragging] = useState<{ key: string; dx: number; dy: number } | null>(null)
  /** A resize in progress: how much bigger, as a fraction of the original. */
  const [sizing, setSizing] = useState<{ sx: number; sy: number } | null>(null)
  /** Where a new line of text is being typed, in PDF coordinates. */
  const [adding, setAdding] = useState<{ x: number; y: number; text: string } | null>(null)

  // What is on this page, and how its coordinates map to the drawn one.
  //
  // The mapping is remeasured whenever the drawn page changes size, because
  // zooming changes every number in it — measured once, the boxes drift away
  // from the words they belong to the first time somebody zooms in to read.
  useEffect(() => {
    let live = true
    let observer: ResizeObserver | null = null

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

        const measure = (): void => {
          if (!live) return
          setGeometry({
            scale: width > 0 ? drawn.clientWidth / width : 1,
            height,
            left: drawn.offsetLeft,
            top: drawn.offsetTop,
            width: drawn.clientWidth
          })
        }
        setObjects(groupTargets(found, { width, height }))
        measure()
        observer = new ResizeObserver(measure)
        observer.observe(drawn)
      } catch {
        if (live) setObjects([])
      }
    })()

    return () => {
      live = false
      observer?.disconnect()
    }
  }, [doc, path, page])

  if (!geometry || objects.length === 0) return null

  /** PDF space has its origin at the bottom left; the page on screen does not. */
  const box = (object: EditTarget): React.CSSProperties => ({
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
        // A line is usually many objects: the new text goes on the first and
        // the rest are removed.
        indexes: picked.indexes,
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

  /**
   * Pick an object up and put it down somewhere else.
   *
   * The movement is followed in CSS pixels and converted once, at the end: a
   * write per pixel of a drag would be a hundred rewrites of the document.
   */
  /** A run's identity, for telling one box from another while dragging. */
  const keyOf = (target: EditTarget): string => target.indexes.join(',')

  const startDrag = (object: EditTarget, event: React.MouseEvent): void => {
    if (busy) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    setPicked(object)
    setDraft(object.text)

    const onMove = (move: MouseEvent): void =>
      setDragging({ key: keyOf(object), dx: move.clientX - startX, dy: move.clientY - startY })

    const onUp = async (up: MouseEvent): Promise<void> => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDragging(null)
      const dx = up.clientX - startX
      const dy = up.clientY - startY
      // A click is not a drag. Below this it was somebody selecting the object.
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      setBusy(true)
      try {
        const result = await invoke('pdf:moveObject', {
          path,
          page: page - 1,
          // Moving acts on the first object of a run: a line that was split
          // into characters moves as one only once it has been retyped.
          index: object.indexes[0]!,
          // Screen pixels down are PDF units up.
          dx: dx / geometry.scale,
          dy: -dy / geometry.scale,
          expectedMtimeMs: mtime
        })
        setPicked(null)
        onChanged(result.mtimeMs)
      } catch {
        useStore.getState().showToast('That could not be moved', 'error')
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /**
   * Drag the corner to make something bigger or smaller.
   *
   * Scaled about its own corner, so it grows where it is rather than sliding
   * away from the page's edge as it gets larger.
   */
  const startResize = (object: EditTarget, event: React.MouseEvent): void => {
    if (busy) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const width = (object.bounds.right - object.bounds.left) * geometry.scale
    const height = (object.bounds.top - object.bounds.bottom) * geometry.scale

    const factors = (moveX: number, moveY: number): { sx: number; sy: number } => ({
      sx: Math.min(20, Math.max(0.05, (width + (moveX - startX)) / Math.max(1, width))),
      sy: Math.min(20, Math.max(0.05, (height + (moveY - startY)) / Math.max(1, height)))
    })

    const onMove = (move: MouseEvent): void => setSizing(factors(move.clientX, move.clientY))

    const onUp = async (up: MouseEvent): Promise<void> => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setSizing(null)
      const { sx, sy } = factors(up.clientX, up.clientY)
      // A nudge is not a resize; below this it was somebody grabbing the handle
      // and letting go again.
      if (Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) return
      setBusy(true)
      try {
        const result = await invoke('pdf:resizeObject', {
          path,
          page: page - 1,
          index: object.indexes[0]!,
          sx,
          sy,
          expectedMtimeMs: mtime
        })
        setPicked(null)
        onChanged(result.mtimeMs)
      } catch {
        useStore.getState().showToast('That could not be resized', 'error')
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** Write a new line onto the page, in a font every reader has. */
  const addText = async (): Promise<void> => {
    if (!adding || adding.text.trim() === '' || busy) return
    setBusy(true)
    try {
      const result = await invoke('pdf:addText', {
        path,
        page: page - 1,
        text: adding.text,
        x: adding.x,
        y: adding.y,
        size: 12,
        expectedMtimeMs: mtime
      })
      setAdding(null)
      onChanged(result.mtimeMs)
    } catch {
      useStore.getState().showToast('That text could not be added', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (object: EditTarget): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await invoke('pdf:removeObjects', {
        path,
        page: page - 1,
        indexes: object.indexes,
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
        setWarned([])
        if (!hit) setAdding(null)
      }}
      onDoubleClick={(event) => {
        // Nothing under the pointer: this is somewhere to write.
        const host = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - host.left) / geometry.scale
        const y = geometry.height - (event.clientY - host.top) / geometry.scale
        if (objectAt(objects, x, y)) return
        setPicked(null)
        setAdding({ x, y, text: '' })
      }}
    >
      {objects.map((object) => {
        const key = keyOf(object)
        const chosen = picked !== null && keyOf(picked) === key
        const shifted = dragging?.key === key ? { x: dragging.dx, y: dragging.dy } : { x: 0, y: 0 }
        const scaled = chosen ? sizing : null
        return (
          <div
            key={key}
            className={`pdfv__object${chosen ? ' pdfv__object--picked' : ''}`}
            style={{
              ...box(object),
              transform:
                [
                  shifted.x || shifted.y ? `translate(${shifted.x}px, ${shifted.y}px)` : '',
                  // From the bottom-left, which is the corner the engine scales
                  // about — so what is previewed is what will happen.
                  scaled ? `scale(${scaled.sx}, ${scaled.sy})` : ''
                ]
                  .filter(Boolean)
                  .join(' ') || undefined,
              transformOrigin: 'left bottom'
            }}
            title={
              object.kind === 'text'
                ? `${object.text} — drag to move`
                : `${object.kind} — drag to move`
            }
            onMouseDown={(event) => startDrag(object, event)}
          >
            {chosen && (
              <span
                className="pdfv__object-handle"
                role="button"
                aria-label="Resize this"
                title="Drag to resize"
                onMouseDown={(event) => startResize(object, event)}
              />
            )}
          </div>
        )
      })}

      {adding && (
        <div
          className="pdfv__object-edit"
          style={{
            left: adding.x * geometry.scale,
            top: (geometry.height - adding.y) * geometry.scale - 24
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="pdfv__object-input"
            aria-label="Write on the page"
            placeholder="New text…"
            autoFocus
            value={adding.text}
            disabled={busy}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addText()
              else if (e.key === 'Escape') setAdding(null)
            }}
          />
        </div>
      )}

      {picked && (
        <div
          className="pdfv__object-edit"
          // Placed at the object's corner, sized by its own content. Stretched
          // to the object it would be as large as the thing being edited — and
          // this panel is opaque, so editing a full-page picture would paint
          // the document out.
          style={{
            left: picked.bounds.left * geometry.scale,
            top: (geometry.height - picked.bounds.top) * geometry.scale,
            minWidth: Math.min(
              360,
              Math.max(120, (picked.bounds.right - picked.bounds.left) * geometry.scale)
            )
          }}
          onClick={(e) => e.stopPropagation()}
        >
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
