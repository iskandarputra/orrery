import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
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
  onGoToPage,
  onGoToDestination
}: {
  doc: PDFDocumentProxy | null
  page: number
  onGoToPage: (page: number) => void
  onGoToDestination: (dest: string | unknown[]) => void
}): React.JSX.Element {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [tab, setTab] = useState<'pages' | 'outline'>('pages')

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
      </div>

      {tab === 'pages' ? (
        <div className="pdfv__thumbs">
          {doc &&
            Array.from({ length: doc.numPages }, (_, i) => (
              <Thumbnail
                key={i + 1}
                doc={doc}
                page={i + 1}
                current={page === i + 1}
                onSelect={() => onGoToPage(i + 1)}
              />
            ))}
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
  current,
  onSelect
}: {
  doc: PDFDocumentProxy
  page: number
  current: boolean
  onSelect: () => void
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
      className={`pdfv__thumb${current ? ' pdfv__thumb--current' : ''}`}
      aria-label={`Page ${page}`}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
    >
      <canvas ref={canvasRef} className="pdfv__thumb-canvas" />
      <span className="pdfv__thumb-number">{page}</span>
    </button>
  )
}
