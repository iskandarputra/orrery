import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { annotationLabel, type AnnotationRef } from '@core/pdf-annotations'
import {
  appendPages,
  extractPages,
  initialPlan,
  isUnchanged,
  movePages,
  removePages,
  rotatePages,
  type PagePlan
} from '@core/pdf-pages'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from '@/components/Icon'

/**
 * The rail beside a PDF: its pages, and its own table of contents.
 *
 * Both are how people navigate a long document — nobody scrolls to page 340.
 * The thumbnails are drawn only when they scroll into view, because rendering
 * a thousand of them up front is a second of frozen app for pictures nobody
 * has looked at yet.
 */

/** Thumbnail width in CSS pixels. Wide enough to recognise a page by shape. */
const THUMB_WIDTH = 116

interface OutlineNode {
  title: string
  bold?: boolean
  italic?: boolean
  dest: string | unknown[] | null
  items: OutlineNode[]
}

export function PdfSidebar({
  doc,
  page,
  marks,
  unsaved,
  onGoToPage,
  onGoToDestination,
  onApplyPlan,
  onExtract,
  onMerge
}: {
  doc: PDFDocumentProxy | null
  page: number
  /** The marks already in the document, gathered by the reader. */
  marks: AnnotationRef[]
  /** True when there are marks made since the last save, which are not listed. */
  unsaved: boolean
  onGoToPage: (page: number) => void
  onGoToDestination: (dest: string | unknown[]) => void
  /** Carry out a rearrangement: the document is rewritten and reopened. */
  onApplyPlan: (plan: PagePlan) => Promise<void>
  /** Write these pages out as a document of their own. */
  onExtract: (plan: PagePlan) => Promise<void>
  /** Rebuild this document from itself and another one. */
  onMerge: (other: string, plan: PagePlan) => Promise<void>
}): React.JSX.Element {
  /**
   * The rearrangement being assembled, and what is selected.
   *
   * Held here rather than written straight to the file: rotating four pages and
   * deleting a fifth is one change to a document, not five rewrites of it, and
   * a plan can be thrown away without having touched anything.
   */
  const [plan, setPlan] = useState<PagePlan | null>(null)
  const [chosen, setChosen] = useState<number[]>([])
  const [working, setWorking] = useState(false)
  /** A thumbnail being dragged, and the gap it is currently over. */
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [tab, setTab] = useState<'pages' | 'outline' | 'marks'>('pages')

  useEffect(() => {
    if (!doc) return
    let live = true
    void doc
      .getOutline()
      .then((items) => {
        if (!live) return
        const found = (items ?? []) as unknown as OutlineNode[]
        setOutline(found)
        // A document that brought a table of contents is a document meant to be
        // read through it, so that is the tab you land on.
        if (found.length > 0) setTab('outline')
      })
      .catch(() => live && setOutline([]))
    return () => {
      live = false
    }
  }, [doc])

  const hasOutline = (outline?.length ?? 0) > 0
  const pages = plan ?? initialPlan(doc?.numPages ?? 0)
  const pending = doc ? !isUnchanged(pages, doc.numPages) : false

  const change = (next: PagePlan): void => {
    setPlan(next)
    setChosen([])
  }
  const chosenOrAll = (): number[] => (chosen.length > 0 ? chosen : pages.order.map((_, i) => i))

  return (
    <aside className="pdfv__side">
      <div className="pdfv__tabs">
        <button
          className={`pdfv__tab${tab === 'pages' ? ' pdfv__tab--active' : ''}`}
          onClick={() => setTab('pages')}
        >
          <Icon name="image" size={12} /> Pages
        </button>
        <button
          className={`pdfv__tab${tab === 'outline' ? ' pdfv__tab--active' : ''}`}
          disabled={!hasOutline}
          title={hasOutline ? 'The document outline' : 'This document has no outline'}
          onClick={() => setTab('outline')}
        >
          <Icon name="list" size={12} /> Outline
        </button>
        <button
          className={`pdfv__tab${tab === 'marks' ? ' pdfv__tab--active' : ''}`}
          title="Everything marked on this document"
          onClick={() => setTab('marks')}
        >
          <Icon name="quote" size={12} /> Notes
          {marks.length > 0 && <span className="pdfv__tab-count">{marks.length}</span>}
        </button>
      </div>

      {tab === 'pages' ? (
        <>
          <div className="pdfv__page-tools">
            <button
              className="pdfv__action"
              aria-label="Turn left"
              title="Turn the selected pages a quarter to the left"
              disabled={working}
              onClick={() => change(rotatePages(pages, chosenOrAll(), -90))}
            >
              <Icon name="undo" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Turn right"
              title="Turn the selected pages a quarter to the right"
              disabled={working}
              onClick={() => change(rotatePages(pages, chosenOrAll(), 90))}
            >
              <Icon name="redo" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Move up"
              title="Move the selected pages earlier"
              disabled={working || chosen.length === 0}
              onClick={() => change(movePages(pages, chosen, Math.max(0, Math.min(...chosen) - 1)))}
            >
              <Icon name="chevron-up" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Move down"
              title="Move the selected pages later"
              disabled={working || chosen.length === 0}
              onClick={() =>
                change(
                  movePages(pages, chosen, Math.min(pages.order.length, Math.max(...chosen) + 2))
                )
              }
            >
              <Icon name="chevron-down" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Remove pages"
              title="Take the selected pages out of the document"
              disabled={working || chosen.length === 0 || chosen.length >= pages.order.length}
              onClick={() => change(removePages(pages, chosen))}
            >
              <Icon name="trash" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Add pages from another PDF"
              title="Put another document's pages after this one's"
              disabled={working}
              onClick={() => {
                setWorking(true)
                void (async () => {
                  try {
                    const other = await invoke('dialog:pickPdf', undefined)
                    if (!other) return
                    const count = await invoke('pdf:pageCount', { path: other })
                    // The second document's pages are numbered from where this
                    // one's stop, which is what the engine is given.
                    await onMerge(other, appendPages(pages, count, doc?.numPages ?? 0))
                  } catch {
                    useStore.getState().showToast('Those pages could not be added', 'error')
                  } finally {
                    setWorking(false)
                  }
                })()
              }}
            >
              <Icon name="file-plus" size={12} />
            </button>
            <button
              className="pdfv__action"
              aria-label="Extract pages"
              title="Save the selected pages as a document of their own"
              disabled={working || chosen.length === 0}
              onClick={() => {
                setWorking(true)
                void onExtract(extractPages(pages, chosen)).finally(() => setWorking(false))
              }}
            >
              <Icon name="external-link" size={12} />
            </button>
          </div>

          {pending && (
            <div className="pdfv__page-pending">
              <span>{pages.order.length} pages, rearranged</span>
              <button
                className="pdfv__action pdfv__action--active"
                disabled={working}
                onClick={() => {
                  setWorking(true)
                  void onApplyPlan(pages)
                    .then(() => setPlan(null))
                    .finally(() => setWorking(false))
                }}
              >
                Apply
              </button>
              <button
                className="pdfv__action"
                disabled={working}
                onClick={() => change(initialPlan(doc?.numPages ?? 0))}
              >
                Undo
              </button>
            </div>
          )}

          <div className="pdfv__thumbs">
            {doc &&
              pages.order.map((source, position) => (
                <Thumbnail
                  key={`${source}:${position}`}
                  doc={doc}
                  page={source + 1}
                  label={position + 1}
                  rotate={pages.rotate[position] ?? 0}
                  current={!pending && page === position + 1}
                  chosen={chosen.includes(position)}
                  dropBefore={drag !== null && drag.over === position && drag.from !== position}
                  onDragStart={() => setDrag({ from: position, over: position })}
                  onDragOver={() => setDrag((d) => (d ? { ...d, over: position } : d))}
                  onDrop={() => {
                    if (!drag) return
                    // Dropping onto a thumbnail means "before this one", which
                    // is the gap at its own position.
                    change(movePages(pages, [drag.from], position))
                    setDrag(null)
                  }}
                  onDragEnd={() => setDrag(null)}
                  onSelect={(additive) => {
                    if (additive) {
                      setChosen((current) =>
                        current.includes(position)
                          ? current.filter((n) => n !== position)
                          : [...current, position]
                      )
                      return
                    }
                    setChosen([position])
                    if (!pending) onGoToPage(position + 1)
                  }}
                />
              ))}
          </div>
        </>
      ) : tab === 'marks' ? (
        <div className="pdfv__marks">
          {marks.length === 0 && !unsaved && (
            <p className="pdfv__marks-empty">Nothing marked on this document yet.</p>
          )}
          {marks.map((entry) => (
            <button
              key={entry.id}
              className="pdfv__mark"
              title={`${entry.kind} on page ${entry.page}${entry.author ? ` — ${entry.author}` : ''}`}
              onClick={() => onGoToPage(entry.page)}
            >
              <span className="pdfv__mark-page">p{entry.page}</span>
              <span className="pdfv__mark-text">{annotationLabel(entry)}</span>
            </button>
          ))}
          {unsaved && (
            <p className="pdfv__marks-empty">New marks appear here once the document is saved.</p>
          )}
        </div>
      ) : (
        <div className="pdfv__outline">
          {outline?.map((item, i) => (
            <OutlineRow key={i} node={item} depth={0} onGo={onGoToDestination} />
          ))}
        </div>
      )}
    </aside>
  )
}

function OutlineRow({
  node,
  depth,
  onGo
}: {
  node: OutlineNode
  depth: number
  onGo: (dest: string | unknown[]) => void
}): React.JSX.Element {
  return (
    <>
      <button
        className="pdfv__outline-row"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        title={node.title}
        disabled={!node.dest}
        onClick={() => node.dest && onGo(node.dest)}
      >
        {node.title || '—'}
      </button>
      {node.items?.map((child, i) => (
        <OutlineRow key={i} node={child} depth={depth + 1} onGo={onGo} />
      ))}
    </>
  )
}

/**
 * One page, drawn once it is nearly on screen and then left alone.
 *
 * The observer is given room below the rail so a thumbnail is ready by the
 * time it is scrolled to, rather than appearing blank and filling in late.
 */
function Thumbnail({
  doc,
  page,
  label,
  rotate,
  current,
  chosen,
  dropBefore,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  doc: PDFDocumentProxy
  /** Which page of the file this is, 1-based. */
  page: number
  /** Where it sits in the arrangement, which is what the reader counts. */
  label: number
  /** How the plan turns it, in degrees. */
  rotate: number
  current: boolean
  chosen: boolean
  /** True when a dragged page would land in front of this one. */
  dropBefore: boolean
  onSelect: (additive: boolean) => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || drawn) return

    let live = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void (async () => {
          try {
            const pdfPage = await doc.getPage(page)
            const canvas = canvasRef.current
            if (!live || !canvas) return
            const base = pdfPage.getViewport({ scale: 1 })
            const ratio = window.devicePixelRatio || 1
            const viewport = pdfPage.getViewport({ scale: (THUMB_WIDTH / base.width) * ratio })
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            canvas.style.width = `${THUMB_WIDTH}px`
            canvas.style.height = `${Math.ceil(viewport.height / ratio)}px`
            await pdfPage.render({ canvas, viewport }).promise
            if (live) setDrawn(true)
          } catch {
            // A page that will not draw is a blank thumbnail, not a broken app.
          }
        })()
      },
      { root: host.closest('.pdfv__thumbs'), rootMargin: '400px 0px' }
    )
    observer.observe(host)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [doc, page, drawn])

  return (
    <button
      ref={hostRef}
      className={`pdfv__thumb${current ? ' pdfv__thumb--current' : ''}${
        chosen ? ' pdfv__thumb--chosen' : ''
      }${dropBefore ? ' pdfv__thumb--drop' : ''}`}
      aria-label={`Page ${label}`}
      aria-current={current ? 'page' : undefined}
      aria-pressed={chosen}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey || event.shiftKey)}
    >
      <canvas
        ref={canvasRef}
        className="pdfv__thumb-canvas"
        style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      />
      <span className="pdfv__thumb-number">{label}</span>
    </button>
  )
}
