import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { groupTargets, missingGlyphs, objectAt, type EditTarget } from '@core/pdf-edit'
import {
  asRotation,
  dragToPdf,
  drawnSize,
  scaleFromDrawnWidth,
  toCss,
  toCssBox,
  toPdf,
  type PageGeometry
} from '@core/pdf-geometry'
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

/**
 * The corner PDFium scales an object about, as it appears on screen.
 *
 * The engine always grows a thing from its own bottom left. On a page turned a
 * quarter that corner is somewhere else on the screen, and previewing the
 * resize about the wrong one shows the object sliding away as it grows — which
 * is not what the file ends up with.
 */
const SCALES_FROM: Record<number, string> = {
  0: 'left bottom',
  90: 'left top',
  180: 'right top',
  270: 'right bottom'
}

/** A box over each object, and the input that replaces one when it is picked. */
export function PdfObjectLayer({
  doc,
  path,
  page,
  alphabet,
  rotation,
  pickAdded,
  beforeEdit,
  onChanged
}: {
  doc: PDFDocumentProxy
  path: string
  /** 1-based, as the reader counts. */
  page: number
  /** Everything this document says, for guessing what its fonts can draw. */
  alphabet: string
  /** How far the reader has turned the pages, on top of the page's own turn. */
  rotation: number
  /** Something was just put on this page: pick it, so its handles are there. */
  pickAdded?: boolean
  /**
   * Fold anything the reader is holding into the document first.
   *
   * The engine that carries these edits out lives in main and rebuilds the
   * document from bytes main has. An annotation made a moment ago is not in
   * those bytes — it is in pdf.js's storage — so without this the rebuild
   * quietly leaves it out and re-reading the page takes it off the screen.
   * False when that could not be done, in which case the edit does not happen
   * either: better nothing than a change that costs somebody a mark.
   */
  beforeEdit: () => Promise<boolean>
  /** The document has changed. It is not on disk: saving is still Ctrl+S. */
  onChanged: () => void
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
    /** The page's size, scale and orientation; everything else asks this. */
    page: PageGeometry
    /** Where the drawn page sits inside the scroller, so the layer can sit on it. */
    left: number
    top: number
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
  /** A turn in progress, in degrees clockwise on screen. */
  const [turning, setTurning] = useState<number | null>(null)
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

        // The page's own turn plus the reader's, which is how pdf.js works out
        // what to draw — so it is how the boxes have to be placed on top of it.
        const turn = asRotation(rotation + (pdfPage.rotate ?? 0))
        const measure = (): void => {
          if (!live) return
          setGeometry({
            page: {
              width,
              height,
              scale: scaleFromDrawnWidth(drawn.clientWidth, { width, height }, turn),
              rotation: turn
            },
            left: drawn.offsetLeft,
            top: drawn.offsetTop
          })
        }
        const targets = groupTargets(found, { width, height })
        setObjects(targets)
        // Whatever was just added is the last object on the page, because that
        // is where the engine appends. Only pictures and shapes are offered
        // this way: a line of text picked on arrival would open its input and
        // take the keyboard away from whatever else was being done.
        if (pickAdded) {
          const last = [...targets].reverse().find((target) => target.kind !== 'text')
          if (last) setPicked(last)
        }
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
  }, [doc, path, page, rotation])

  if (!geometry || objects.length === 0) return null

  const drawn = drawnSize(geometry.page)

  /** Where something on the page ends up on the screen, whichever way up. */
  const box = (object: EditTarget): React.CSSProperties => toCssBox(geometry.page, object.bounds)

  /** A point on the screen, in the page's own coordinates. */
  const pointIn = (
    host: DOMRect,
    event: { clientX: number; clientY: number }
  ): { x: number; y: number } =>
    toPdf(geometry.page, { x: event.clientX - host.left, y: event.clientY - host.top })

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
      if (!(await beforeEdit())) return
      await invoke('pdf:editObject', {
        path,
        page: page - 1,
        // A line is usually many objects: the new text goes on the first and
        // the rest are removed.
        indexes: picked.indexes,
        text: draft
      })
      setPicked(null)
      onChanged()
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
      // Which way the page is turned decides which of its axes the hand moved
      // along: sideways across a page on its side is up and down the page.
      const moved = dragToPdf(geometry.page, { x: dx, y: dy })
      try {
        if (!(await beforeEdit())) return
        await invoke('pdf:moveObject', {
          path,
          page: page - 1,
          // Moving acts on the first object of a run: a line that was split
          // into characters moves as one only once it has been retyped.
          index: object.indexes[0]!,
          dx: moved.x,
          dy: moved.y
        })
        setPicked(null)
        onChanged()
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
    const drawnBox = toCssBox(geometry.page, object.bounds)
    const turned = geometry.page.rotation === 90 || geometry.page.rotation === 270

    /**
     * How much bigger, along the page's own axes.
     *
     * The hand moves in screen pixels and the engine scales in page units, and
     * on a page turned a quarter those are not the same pair — pulling the
     * handle sideways makes a line taller, not longer.
     */
    const factors = (moveX: number, moveY: number): { sx: number; sy: number } => {
      const across = Math.min(
        20,
        Math.max(0.05, (drawnBox.width + (moveX - startX)) / Math.max(1, drawnBox.width))
      )
      const down = Math.min(
        20,
        Math.max(0.05, (drawnBox.height + (moveY - startY)) / Math.max(1, drawnBox.height))
      )
      return turned ? { sx: down, sy: across } : { sx: across, sy: down }
    }

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
        if (!(await beforeEdit())) return
        await invoke('pdf:resizeObject', {
          path,
          page: page - 1,
          index: object.indexes[0]!,
          sx,
          sy
        })
        setPicked(null)
        onChanged()
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
      if (!(await beforeEdit())) return
      await invoke('pdf:addText', {
        path,
        page: page - 1,
        text: adding.text,
        x: adding.x,
        y: adding.y,
        size: 12
      })
      setAdding(null)
      onChanged()
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
      if (!(await beforeEdit())) return
      await invoke('pdf:removeObjects', {
        path,
        page: page - 1,
        indexes: object.indexes
      })
      setPicked(null)
      onChanged()
    } catch {
      useStore.getState().showToast('That could not be removed', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Drag the handle above an object to turn it.
   *
   * The angle is wherever the pointer is, measured from the object's middle,
   * because that is the gesture every other rotate handle uses. Held with
   * Shift it snaps to fifteen degrees, which is how somebody gets a stamp back
   * to square after overshooting it.
   */
  const startRotate = (object: EditTarget, event: React.MouseEvent): void => {
    if (busy) return
    event.preventDefault()
    event.stopPropagation()
    const host = (event.currentTarget as HTMLElement).closest('.pdfv__objects')
    if (!host) return
    const area = host.getBoundingClientRect()
    const drawnBox = toCssBox(geometry.page, object.bounds)
    const middle = {
      x: area.left + drawnBox.left + drawnBox.width / 2,
      y: area.top + drawnBox.top + drawnBox.height / 2
    }
    // Straight up from the middle is nought, so the number on screen is the
    // number somebody expects to see.
    const angleAt = (x: number, y: number, snap: boolean): number => {
      const raw = (Math.atan2(x - middle.x, middle.y - y) * 180) / Math.PI
      return snap ? Math.round(raw / 15) * 15 : Math.round(raw)
    }

    const onMove = (move: MouseEvent): void =>
      setTurning(angleAt(move.clientX, move.clientY, move.shiftKey))

    const onUp = async (up: MouseEvent): Promise<void> => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTurning(null)
      const degrees = angleAt(up.clientX, up.clientY, up.shiftKey)
      // A twitch is not a turn.
      if (Math.abs(degrees) < 2) return
      setBusy(true)
      try {
        if (!(await beforeEdit())) return
        await invoke('pdf:rotateObject', {
          path,
          page: page - 1,
          index: object.indexes[0]!,
          // Clockwise on screen is anticlockwise in a page's own coordinates,
          // whose y counts upwards.
          degrees: -degrees
        })
        setPicked(null)
        onChanged()
      } catch {
        useStore.getState().showToast('That could not be turned', 'error')
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="pdfv__objects"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: drawn.width,
        height: drawn.height
      }}
      onClick={(event) => {
        // A click anywhere on the page picks whatever is smallest under it,
        // which is how you get the words rather than the box behind them.
        const { x, y } = pointIn(event.currentTarget.getBoundingClientRect(), event)
        const hit = objectAt(objects, x, y)
        setPicked(hit)
        setDraft(hit?.text ?? '')
        setWarned([])
        if (!hit) setAdding(null)
      }}
      onDoubleClick={(event) => {
        // Nothing under the pointer: this is somewhere to write.
        const { x, y } = pointIn(event.currentTarget.getBoundingClientRect(), event)
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
            // What sort of thing this is, which the title cannot be relied on
            // to say: the tooltip service borrows `title` for as long as the
            // pointer is over an element, so anything reading it mid-hover
            // finds nothing there.
            data-kind={object.kind}
            style={{
              ...box(object),
              transform:
                [
                  shifted.x || shifted.y ? `translate(${shifted.x}px, ${shifted.y}px)` : '',
                  // From the bottom-left, which is the corner the engine scales
                  // about — so what is previewed is what will happen.
                  scaled ? `scale(${scaled.sx}, ${scaled.sy})` : '',
                  chosen && turning !== null ? `rotate(${turning}deg)` : ''
                ]
                  .filter(Boolean)
                  .join(' ') || undefined,
              transformOrigin: SCALES_FROM[geometry.page.rotation]
            }}
            title={
              object.kind === 'text'
                ? `${object.text} — drag to move`
                : `${object.kind} — drag to move`
            }
            onMouseDown={(event) => startDrag(object, event)}
          >
            {chosen && (
              <>
                <span
                  className="pdfv__object-handle"
                  role="button"
                  aria-label="Resize this"
                  title="Drag to resize"
                  onMouseDown={(event) => startResize(object, event)}
                />
                <span
                  className="pdfv__object-turn"
                  role="button"
                  aria-label="Turn this"
                  title="Drag to turn — hold Shift for fifteen degrees at a time"
                  onMouseDown={(event) => startRotate(object, event)}
                />
                {turning !== null && <span className="pdfv__object-angle">{turning}°</span>}
              </>
            )}
          </div>
        )
      })}

      {adding && (
        <div
          className="pdfv__object-edit"
          style={{
            left: toCss(geometry.page, adding).x,
            top: toCss(geometry.page, adding).y - 24
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
            left: toCssBox(geometry.page, picked.bounds).left,
            top: toCssBox(geometry.page, picked.bounds).top,
            minWidth: Math.min(360, Math.max(120, toCssBox(geometry.page, picked.bounds).width))
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
            left: toCssBox(geometry.page, picked.bounds).left,
            top:
              toCssBox(geometry.page, picked.bounds).top +
              toCssBox(geometry.page, picked.bounds).height +
              4
          }}
        >
          This document has never drawn {warned.join(' ')}, so its font may have no glyph for{' '}
          {warned.length === 1 ? 'it' : 'them'}. Press Enter again to change it anyway.
        </p>
      )}
    </div>
  )
}
