import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  EventBus,
  PDFLinkService,
  PDFViewer as PdfjsViewer
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import { resolveAssetUrl } from '@core/asset'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'
import { useStore } from '@/state/store'
import { loadPdfjs } from './pdfjs-lazy'
import { PdfSidebar } from './PdfSidebar'

/**
 * A PDF, read.
 *
 * The one document kind an editor cannot open by reading it: the bytes are a
 * page tree and a pile of compressed streams. pdf.js draws it, and its viewer
 * components bring the parts nobody should write twice — a text layer you can
 * select and copy from, find with a match count, virtualised pages so a
 * thousand-page scan scrolls, and the annotation machinery the next stage needs.
 *
 * The file is loaded straight from `orrery-asset://`, which already serves
 * local files to the renderer, so the bytes are streamed by the protocol
 * handler rather than copied through an IPC message.
 *
 * Nothing here writes. A PDF opened in Orrery today is a document being read;
 * the tab is never dirty and the file on disk is never touched.
 */

/** How far each zoom button moves, and where it stops. */
const ZOOM_STEP = 1.1
const MIN_SCALE = 0.25
const MAX_SCALE = 10

/**
 * Where each file was left, for as long as the app is running.
 *
 * Coming back to a tab you were reading and finding page 1 is the single most
 * irritating thing a PDF reader can do. Not persisted to disk yet — that is a
 * setting, and this is a session.
 */
const lastSeen = new Map<string, { page: number; scale: string }>()

export function PdfViewer({ bufferId }: { bufferId: string }): React.JSX.Element {
  const path = useStore((s) => s.buffers[bufferId]?.filePath ?? '')
  // The protocol the renderer is allowed to read local files over. Worked out
  // here rather than in the effect: it is a pure function of the path, and a
  // path it cannot resolve is something to render, not something to remember.
  const url = path ? resolveAssetUrl(null, path) : null

  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PdfjsViewer | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const linksRef = useRef<PDFLinkService | null>(null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [zoomMode, setZoomMode] = useState('auto')
  const [sidebar, setSidebar] = useState(true)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    if (!url) return

    let live = true
    let destroy: (() => void) | null = null

    void (async () => {
      try {
        const { api, viewer: components, documentOptions } = await loadPdfjs()
        if (!live || !scrollRef.current || !pagesRef.current) return

        const eventBus = new components.EventBus()
        const linkService = new components.PDFLinkService({ eventBus })
        const findController = new components.PDFFindController({ eventBus, linkService })
        const pdfViewer = new components.PDFViewer({
          container: scrollRef.current,
          viewer: pagesRef.current,
          eventBus,
          linkService,
          findController,
          l10n: new components.GenericL10n('en-US'),
          textLayerMode: 1,
          // Annotations are drawn, but their form fields are not interactive:
          // a field you can type into that cannot be saved would be a lie. The
          // stage that can save them turns this up.
          annotationMode: api.AnnotationMode.ENABLE
        })
        linkService.setViewer(pdfViewer)

        viewerRef.current = pdfViewer
        busRef.current = eventBus
        linksRef.current = linkService

        const remembered = lastSeen.get(path)
        eventBus.on('pagesinit', () => {
          pdfViewer.currentScaleValue = remembered?.scale ?? 'auto'
          if (remembered) pdfViewer.currentPageNumber = remembered.page
        })
        eventBus.on('pagechanging', (e: { pageNumber: number }) => {
          setPage(e.pageNumber)
          lastSeen.set(path, {
            page: e.pageNumber,
            scale: String(pdfViewer.currentScaleValue ?? 'auto')
          })
        })
        eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
          setScale(e.scale)
          setZoomMode(e.presetValue ?? 'custom')
        })
        eventBus.on(
          'updatefindmatchescount',
          (e: { matchesCount: { current: number; total: number } }) => {
            setMatches(e.matchesCount)
          }
        )
        eventBus.on('updatefindcontrolstate', (e: { matchesCount: { total: number } }) => {
          setMatches(e.matchesCount.total > 0 ? { current: 0, ...e.matchesCount } : null)
        })

        const task = api.getDocument({ url, ...documentOptions })
        // Tearing down the loading task is what releases the document, its
        // worker and every page it has drawn; the document proxy has no destroy
        // of its own.
        destroy = () => void task.destroy()
        const pdf = await task.promise
        if (!live) return
        pdfViewer.setDocument(pdf)
        linkService.setDocument(pdf)
        setDoc(pdf)
        setPageCount(pdf.numPages)

        // A pane that changes width has to re-fit, or "fit width" stops being
        // true the moment a sidebar opens beside it.
        const observer = new ResizeObserver(() => {
          const current = pdfViewer.currentScaleValue
          if (current === 'auto' || current === 'page-width' || current === 'page-fit') {
            pdfViewer.currentScaleValue = current
          }
        })
        observer.observe(scrollRef.current)

        destroy = () => {
          observer.disconnect()
          pdfViewer.setDocument(null as never)
          linkService.setDocument(null as never)
          void task.destroy()
        }
        if (!live) destroy()
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : 'This PDF could not be opened.')
      }
    })()

    return () => {
      live = false
      destroy?.()
      viewerRef.current = null
      busRef.current = null
      linksRef.current = null
    }
  }, [path, url])

  const zoomBy = (factor: number): void => {
    const view = viewerRef.current
    if (!view) return
    view.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.currentScale * factor))
  }

  const setZoom = (value: string): void => {
    if (viewerRef.current) viewerRef.current.currentScaleValue = value
  }

  const goToPage = (next: number): void => {
    const view = viewerRef.current
    if (!view || !Number.isFinite(next)) return
    view.currentPageNumber = Math.min(Math.max(1, Math.trunc(next)), view.pagesCount)
  }

  const rotate = (): void => {
    const view = viewerRef.current
    if (view) view.pagesRotation = (view.pagesRotation + 90) % 360
  }

  const find = (again: boolean, backwards = false): void => {
    busRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: backwards,
      matchDiacritics: false
    })
  }

  const trouble = error ?? (path && !url ? 'This file is somewhere the reader cannot reach.' : null)
  if (trouble) {
    return (
      <div className="pdfv">
        <EmptyState icon="alert-triangle">{trouble}</EmptyState>
      </div>
    )
  }

  return (
    <div className="pdfv">
      <div className="pdfv__bar">
        <button
          className={`pdfv__action${sidebar ? ' pdfv__action--active' : ''}`}
          aria-label="Toggle the sidebar"
          title="Pages and outline"
          onClick={() => setSidebar((open) => !open)}
        >
          <Icon name="columns" size={13} />
        </button>

        <span className="pdfv__pager">
          <button
            className="pdfv__action"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <input
            className="pdfv__page-input"
            aria-label="Page number"
            value={page}
            onChange={(e) => goToPage(Number(e.target.value))}
          />
          <span className="pdfv__count">of {pageCount || '—'}</span>
          <button
            className="pdfv__action"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => goToPage(page + 1)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
        </span>

        <span className="pdfv__spacer" />

        <button
          className="pdfv__action"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Icon name="minus" size={13} />
        </button>
        <span className="pdfv__zoom">{Math.round(scale * 100)}%</span>
        <button className="pdfv__action" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
          <Icon name="plus" size={13} />
        </button>
        <select
          className="pdfv__fit"
          aria-label="Zoom level"
          value={
            ['auto', 'page-width', 'page-fit', 'custom'].includes(zoomMode) ? zoomMode : 'auto'
          }
          onChange={(e) => setZoom(e.target.value)}
        >
          <option value="auto">Automatic</option>
          <option value="page-width">Fit width</option>
          <option value="page-fit">Fit page</option>
          <option value="1">Actual size</option>
          <option value="custom" disabled>
            Custom
          </option>
        </select>

        <button className="pdfv__action" aria-label="Rotate the pages" onClick={rotate}>
          <Icon name="refresh" size={13} />
        </button>
        <button
          className={`pdfv__action${finding ? ' pdfv__action--active' : ''}`}
          aria-label="Find in this document"
          onClick={() => setFinding((open) => !open)}
        >
          <Icon name="search" size={13} />
        </button>
      </div>

      {finding && (
        <div className="pdfv__find">
          <input
            className="pdfv__find-input"
            aria-label="Find in document"
            placeholder="Find in document…"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) setMatches(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(true, e.shiftKey)
              else if (e.key === 'Escape') setFinding(false)
            }}
          />
          <button className="pdfv__action" aria-label="Find" onClick={() => find(false)}>
            <Icon name="search" size={13} />
          </button>
          <span className="pdfv__find-count">
            {query === ''
              ? ''
              : matches && matches.total > 0
                ? `${matches.current} of ${matches.total}`
                : 'no matches'}
          </span>
          <button
            className="pdfv__action"
            aria-label="Previous match"
            onClick={() => find(true, true)}
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <button className="pdfv__action" aria-label="Next match" onClick={() => find(true)}>
            <Icon name="chevron-down" size={13} />
          </button>
          <button
            className="pdfv__action"
            aria-label="Close find"
            onClick={() => setFinding(false)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div className="pdfv__body">
        {sidebar && (
          <PdfSidebar
            doc={doc}
            page={page}
            onGoToPage={goToPage}
            onGoToDestination={(dest) => void linksRef.current?.goToDestination(dest)}
          />
        )}
        {/* pdf.js measures against this element and refuses to run unless it is
            absolutely positioned; the class carries that, not an inline style. */}
        <div className="pdfv__scroll" ref={scrollRef}>
          <div className="pdfViewer" ref={pagesRef} />
        </div>
      </div>
    </div>
  )
}
