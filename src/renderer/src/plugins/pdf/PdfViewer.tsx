import { useEffect, useReducer, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  EventBus,
  PDFLinkService,
  PDFViewer as PdfjsViewer
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import { resolveAssetUrl } from '@core/asset'
import { basename, stem } from '@core/paths'
import { quoteFromPdf } from '@core/pdf-text'
import { invoke } from '@/services/client'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/PanelBits'
import { useStore } from '@/state/store'
import { loadPdfjs } from './pdfjs-lazy'
import { readPage, startReader } from './ocr'
import { registerCloser, registerSaver, registerUndo } from './saving'
import { PdfObjectLayer } from './PdfObjectLayer'
import { annotationList, type AnnotationRef, type RawAnnotation } from '@core/pdf-annotations'
import type { PagePlan } from '@core/pdf-pages'
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
 * Nothing here writes to the file except the save. Marking a page up, filling a
 * form and editing the page's own contents all change a document held elsewhere
 * — pdf.js's annotation storage for the first two, a draft in main for the
 * third — and the tab carries the dot that says so. Ctrl+S is what puts any of
 * it on disk, and closing without saving throws it away, exactly as for a note.
 */

/**
 * pdf.js's annotation editor modes.
 *
 * Its own constants live behind a dynamic import, and a toolbar cannot wait for
 * one to draw a button. These are the values from `AnnotationEditorType`, and
 * the e2e checks a tool actually turns on rather than trusting the numbers.
 */
const TOOLS = [
  { mode: 9, icon: 'pencil', label: 'Highlight' },
  { mode: 3, icon: 'type', label: 'Text box' },
  { mode: 15, icon: 'diagram', label: 'Draw' },
  { mode: 101, icon: 'pencil', label: 'Signature' }
] as const

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
const lastSeen = new Map<string, { page: number; scale: string; rotation: number }>()

export function PdfViewer({ bufferId }: { bufferId: string }): React.JSX.Element {
  const path = useStore((s) => s.buffers[bufferId]?.filePath ?? '')
  /** Bumped when the document has changed and must be read again. */
  const [reloadToken, setReload] = useState(0)
  /**
   * The same count, readable from a callback.
   *
   * `reloadToken` in a handler is whatever it was when that handler was made,
   * and a reload triggered while one is awaiting leaves it a step behind — so
   * anything that has to name the *next* reload asks this instead of adding one
   * to a number that may already have moved.
   */
  const reloadRef = useRef(0)
  /**
   * The reload a picture was added on, so that picture arrives already picked.
   *
   * Dragging works on any box, but the handles that resize and turn one only
   * appear on what is picked — and somebody who has just placed a picture
   * should not have to work out that they need to click it first.
   */
  const [pickedAt, setPickedAt] = useState(-1)
  // The protocol the renderer is allowed to read local files over. Worked out
  // here rather than in the effect: it is a pure function of the path, and a
  // path it cannot resolve is something to render, not something to remember.
  const base = path ? resolveAssetUrl(null, path) : null
  const url = base
  // A search hit or a `[[paper.pdf#page=12]]` link, asking for a page.
  const pdfTarget = useStore((s) => s.pdfTarget)

  /** The surface itself, so it can hear a keystroke aimed at the document. */
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PdfjsViewer | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const linksRef = useRef<PDFLinkService | null>(null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  // The saver is registered once and outlives any particular render, so it
  // reads the document through a ref rather than closing over one.
  const docRef = useRef<PDFDocumentProxy | null>(null)
  /** The loading task behind the open document, so a replaced one can be let go. */
  const taskRef = useRef<{ destroy(): Promise<void> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [zoomMode, setZoomMode] = useState('auto')
  const [sidebar, setSidebar] = useState(true)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null)
  /** Pages with no text on them: a scan, until somebody recognises it. */
  const [emptyPages, setEmptyPages] = useState<number[]>([])
  /** Everything the document says, for guessing what its fonts can draw. */
  const [alphabet, setAlphabet] = useState('')
  /** Whether the page's own contents are being edited rather than annotated. */
  const [editing, setEditing] = useState(false)
  /**
   * How far the pages have been turned.
   *
   * Tracked because the editing layer has to place its boxes on the page as
   * drawn, not as stored: on a turned page the two do not agree, and a box in
   * the wrong place is a click that retypes the wrong line.
   */
  const [rotation, setRotation] = useState(0)
  /** Whether stepping back or forward through this document's changes is possible. */
  const [steps, setSteps] = useState({ undo: false, redo: false })
  const [reading, setReading] = useState<string | null>(null)
  /** Which annotation tool is in hand, as pdf.js numbers them. */
  const [tool, setTool] = useState(0)
  /**
   * Whether this document says something the file does not.
   *
   * Two things can put it here and they are held in different places: an
   * annotation or a form value, which lives in pdf.js's storage until it is
   * serialised, and a change to the page itself, which lives as a draft in
   * main. Either one is a dot on the tab and a Ctrl+S that has work to do.
   */
  const [dirty, setDirty] = useState(false)
  /**
   * The same answer, readable straight away.
   *
   * An edit sets the state and a re-render then hands the new `save` to Ctrl+S.
   * Between those two the keystroke would still be holding the old one, which
   * believed there was nothing to write — so a save pressed the instant after
   * an edit would do nothing at all. The ref has no such gap.
   */
  const dirtyRef = useRef(false)
  /**
   * Whether pdf.js in particular is holding something.
   *
   * Kept apart from `dirty` because it decides two things `dirty` cannot: that
   * a save has to send the whole document over rather than letting main write
   * the draft it already has, and that an edit to the page must fold the marks
   * in first — an engine that rebuilt the document from the draft alone would
   * take them away.
   */
  const marksDirty = useRef(false)
  const [saving, setSaving] = useState(false)
  /**
   * What the file's timestamp was when this reader last agreed with it.
   *
   * Recorded on open, not only after a save: without it the first write has
   * nothing to compare against and would overwrite a document that changed on
   * disk while it was being read.
   */
  const [savedMtime, setSavedMtime] = useState<number | null>(null)
  const [marks, setMarks] = useState<AnnotationRef[]>([])
  /** Bumped after a save, to read the document's marks again. */
  const [marksToken, rereadMarks] = useReducer((n: number) => n + 1, 0)
  /** Bumped when the file has been rewritten and must be read again. */

  useEffect(() => {
    if (!url) return

    let live = true
    let destroy: (() => void) | null = null

    void (async () => {
      try {
        const { api, viewer: components, documentOptions } = await loadPdfjs()
        if (!live || !scrollRef.current || !pagesRef.current) return

        const eventBus = new components.EventBus()
        const linkService = new components.PDFLinkService({
          eventBus,
          // A link in a PDF opens in the browser, not in here. The window
          // refuses to navigate — that is what stops a document taking the app
          // somewhere — so a link left to open in place does nothing at all,
          // silently. Asking for a new window routes it through the handler
          // that hands http(s) to the operating system and denies the rest.
          externalLinkTarget: components.LinkTarget.BLANK,
          externalLinkRel: 'noopener noreferrer'
        })
        const findController = new components.PDFFindController({ eventBus, linkService })
        const pdfViewer = new components.PDFViewer({
          container: scrollRef.current,
          viewer: pagesRef.current,
          eventBus,
          linkService,
          findController,
          l10n: new components.GenericL10n('en-US'),
          textLayerMode: 1,
          // Forms can be filled in and annotations made, because both can now
          // be saved back into the file.
          annotationMode: api.AnnotationMode.ENABLE_FORMS,
          annotationEditorMode: api.AnnotationEditorType.NONE
        })
        linkService.setViewer(pdfViewer)

        viewerRef.current = pdfViewer
        busRef.current = eventBus
        linksRef.current = linkService

        eventBus.on('pagesinit', () => {
          // Read now, not when the viewer was built: this fires again every
          // time the document is swapped for a rewritten one, and a snapshot
          // taken at open time would put the zoom back to what it was then.
          const remembered = lastSeen.get(path)
          pdfViewer.currentScaleValue = remembered?.scale ?? 'auto'
          // Handing the viewer a rewritten document resets its rotation, so an
          // edit made on a page somebody had turned would leave the page
          // upright and this component still believing it was on its side —
          // and the editing boxes are placed from that belief.
          const turn = remembered?.rotation ?? 0
          pdfViewer.pagesRotation = turn
          setRotation(turn)
          // An asked-for page beats where you left off. A search hit or a
          // `#page=` link is a request about this moment; the remembered page
          // is only where the tab happened to be last time, and letting it win
          // sends the link to the wrong place.
          const asked = useStore.getState().pdfTarget
          const wanted = asked?.path === path ? asked.page : remembered?.page
          if (wanted) pdfViewer.currentPageNumber = wanted
        })
        eventBus.on('pagechanging', (e: { pageNumber: number }) => {
          setPage(e.pageNumber)
          lastSeen.set(path, {
            page: e.pageNumber,
            scale: String(pdfViewer.currentScaleValue ?? 'auto'),
            rotation: pdfViewer.pagesRotation
          })
        })
        eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
          setScale(e.scale)
          setZoomMode(e.presetValue ?? 'custom')
          // Remembered here as well as on a page change: zooming without
          // turning a page is the common case, and without this the zoom was
          // only ever recorded by accident — so a reload went back to whatever
          // it had been when the page last changed.
          lastSeen.set(path, {
            rotation: pdfViewer.pagesRotation,
            page: pdfViewer.currentPageNumber,
            scale: String(pdfViewer.currentScaleValue ?? 'auto')
          })
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

        const task = api.getDocument({ url: `${url}?v=0`, ...documentOptions })
        // Tearing down the loading task is what releases the document, its
        // worker and every page it has drawn; the document proxy has no destroy
        // of its own.
        taskRef.current = task
        destroy = () => void task.destroy()
        const pdf = await task.promise
        if (!live) return
        pdfViewer.setDocument(pdf)
        linkService.setDocument(pdf)
        docRef.current = pdf
        // What the file looked like when this reader agreed with it.
        void invoke('fs:stat', { path })
          .then((stat) => live && setSavedMtime(stat.mtimeMs))
          .catch(() => undefined)
        setDoc(pdf)
        setPageCount(pdf.numPages)

        // Anything the editor or a form field puts in the storage makes the
        // tab dirty, which is what puts the dot on it and what makes closing
        // ask rather than throw the work away.
        // pdf.js types this hook as `null`; it is a callback slot, and this is
        // how the viewer it ships with uses it too.
        ;(pdf.annotationStorage as unknown as { onSetModified: () => void }).onSetModified = () => {
          marksDirty.current = true
          dirtyRef.current = true
          setDirty(true)
          useStore.getState().setDirty(bufferId, true)
        }

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
      docRef.current = null
      viewerRef.current = null
      busRef.current = null
      linksRef.current = null
    }
  }, [bufferId, path, url])

  /**
   * Every mark already in the document, gathered when it opens and after each
   * save.
   *
   * Read from the file rather than from the editor, so what is listed is what
   * another reader would see. Marks made since the last save are not in the
   * file yet, which is why the panel says so rather than pretending otherwise.
   */
  useEffect(() => {
    if (!doc) return
    let live = true
    void (async () => {
      try {
        const pages: { page: number; annotations: RawAnnotation[] }[] = []
        for (let number = 1; number <= doc.numPages; number++) {
          const pdfPage = await doc.getPage(number)
          pages.push({ page: number, annotations: await pdfPage.getAnnotations() })
        }
        if (live) setMarks(annotationList(pages))
      } catch {
        if (live) setMarks([])
      }
    })()
    return () => {
      live = false
    }
  }, [doc, marksToken])

  /**
   * Read the file again after it has been changed, without rebuilding anything.
   *
   * The whole reader used to be torn down and made afresh: the pages vanished
   * while a large document re-rendered — which on a real one reads as the
   * viewer going black — and the zoom fell back to automatic because a new
   * viewer knows nothing about the old one. Swapping the document into the
   * viewer that is already there keeps the zoom, the page and the scroll
   * position, and keeps the pages on screen while it happens.
   */
  useEffect(() => {
    if (reloadToken === 0 || !url) return
    const view = viewerRef.current
    if (!view) return

    let live = true
    void (async () => {
      try {
        const { api, documentOptions } = await loadPdfjs()
        // The same URL twice is served from the cache, so the count makes this
        // a different fetch; the protocol handler ignores the query.
        const task = api.getDocument({ url: `${url}?v=${reloadToken}`, ...documentOptions })
        const pdf = await task.promise
        if (!live) {
          void task.destroy()
          return
        }

        // Where the reader is now, kept where the restoring code looks for it.
        // Setting the page and zoom directly after the swap does not work: the
        // viewer initialises asynchronously, so the assignment lands before
        // there are any pages — and `pagesinit`, which fires afterwards, would
        // overwrite it anyway.
        lastSeen.set(path, {
          page: view.currentPageNumber,
          scale: String(view.currentScaleValue ?? 'auto'),
          rotation: view.pagesRotation
        })
        const scrolled = scrollRef.current?.scrollTop ?? 0

        const previous = taskRef.current
        taskRef.current = task
        docRef.current = pdf
        // The document that comes back already has whatever was staged into it,
        // so this storage starts empty and stays quiet until somebody marks the
        // page again.
        marksDirty.current = false
        ;(pdf.annotationStorage as unknown as { onSetModified: () => void }).onSetModified = () => {
          marksDirty.current = true
          dirtyRef.current = true
          setDirty(true)
          useStore.getState().setDirty(bufferId, true)
        }
        view.setDocument(pdf)
        linksRef.current?.setDocument(pdf)
        setDoc(pdf)
        setPageCount(pdf.numPages)

        // The page and zoom come back through `pagesinit`; the scroll position
        // is put back once the pages it refers to are there.
        requestAnimationFrame(() => {
          if (live && scrollRef.current) scrollRef.current.scrollTop = scrolled
        })
        void previous?.destroy()
      } catch {
        useStore.getState().showToast('This document could not be read again', 'error')
      }
    })()

    return () => {
      live = false
    }
  }, [reloadToken, url, bufferId, path])

  // Which pages have nothing on them, from the same cache search reads. Asked
  // once the document is up, because the answer is about this file and not
  // about what is drawn.
  useEffect(() => {
    if (!path || !doc) return
    let live = true
    void invoke('pdf:text', { path })
      .then((text) => {
        if (!live) return
        setEmptyPages(text.emptyPages)
        setAlphabet(text.pages.join(''))
      })
      .catch(() => live && setEmptyPages([]))
    return () => {
      live = false
    }
  }, [path, doc])

  /**
   * Read the pages that have no text on them.
   *
   * Rendered at twice the size they are read at: recognition wants pixels, and
   * a page drawn for a screen has about half of what it needs. The result goes
   * into the same cache extraction fills, so a recognised scan is searchable
   * from the vault immediately afterwards.
   */
  const recognise = async (): Promise<void> => {
    if (!doc || !path || emptyPages.length === 0 || reading) return
    setReading('starting')
    try {
      const worker = await startReader()
      const found: { page: number; text: string }[] = []
      try {
        for (const [index, number] of emptyPages.entries()) {
          setReading(`page ${index + 1} of ${emptyPages.length}`)
          const pdfPage = await doc.getPage(number)
          const viewport = pdfPage.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await pdfPage.render({ canvas, viewport }).promise
          const text = await readPage(worker, canvas)
          pdfPage.cleanup()
          if (text) found.push({ page: number, text })
        }
      } finally {
        await worker.terminate()
      }
      const merged = await invoke('pdf:recognised', { path, pages: found })
      setEmptyPages(merged.emptyPages)
      useStore
        .getState()
        .showToast(
          found.length > 0
            ? `Recognised ${found.length} page${found.length === 1 ? '' : 's'}`
            : 'Nothing legible on those pages',
          found.length > 0 ? 'success' : 'info'
        )
    } catch {
      useStore.getState().showToast('Those pages could not be recognised', 'error')
    } finally {
      setReading(null)
    }
  }

  useEffect(() => {
    reloadRef.current = reloadToken
  }, [reloadToken])

  /**
   * The document has changed and is not on disk: read it again, and say so.
   *
   * Every edit ends here. The reader is served the draft rather than the file,
   * so re-reading shows the change; the dot on the tab is what says it has not
   * been written yet.
   */
  const changed = (): number => {
    const next = reloadRef.current + 1
    reloadRef.current = next
    setReload(next)
    dirtyRef.current = true
    setDirty(true)
    useStore.getState().setDirty(bufferId, true)
    return next
  }

  // Turning to a requested page waits for the document: the request usually
  // arrives with the tab, before there are any pages to turn to.
  useEffect(() => {
    if (!pdfTarget || !doc || pdfTarget.path !== path) return
    const view = viewerRef.current
    if (!view) return
    view.currentPageNumber = Math.min(Math.max(1, pdfTarget.page), doc.numPages)
  }, [pdfTarget, doc, path])

  /**
   * Fold what pdf.js is holding into the draft in main, writing nothing.
   *
   * Annotations and form values live in pdf.js's storage, and the engine that
   * edits the page itself lives in main and reads the draft. Without this step
   * an edit made after marking a page up would rebuild the document from bytes
   * the mark was never in, and re-reading would take it away — silently, with
   * the tab still claiming there was something to save. So the reader hands its
   * version over first, and the edit lands on top of it.
   */
  const stage = async (): Promise<boolean> => {
    const pdf = docRef.current
    if (!pdf || !path || !marksDirty.current) return true
    try {
      await invoke('pdf:stage', { path, bytes: await pdf.saveDocument() })
      pdf.annotationStorage.resetModified()
      marksDirty.current = false
      return true
    } catch {
      useStore.getState().showToast('That change could not be made', 'error')
      return false
    }
  }

  /**
   * Write this document to disk. The only thing here that does.
   *
   * What goes out is the draft in main with pdf.js's marks folded in, and the
   * marks are serialised as an incremental update — the bytes underneath are
   * kept and the new objects appended — so a document that has only been
   * annotated comes out as the one somebody sent plus what was added to it. The
   * mtime check is the one every save in this app uses: a file changed
   * underneath is refused rather than overwritten.
   */
  const save = async (): Promise<boolean> => {
    const pdf = docRef.current
    if (!pdf || !path) return true
    // Nothing to write. Saving anyway would rewrite somebody's document to say
    // exactly what it already said, and move its timestamp for nothing.
    if (!dirtyRef.current) return true
    setSaving(true)
    try {
      // Only when pdf.js has something the draft does not: otherwise main
      // already holds the answer, and sending a scanned document across the
      // boundary to be written back unchanged is a copy for nothing.
      const bytes = marksDirty.current ? await pdf.saveDocument() : null
      const result = await invoke('pdf:save', {
        path,
        bytes,
        expectedMtimeMs: savedMtime
      })
      setSavedMtime(result.mtimeMs)
      pdf.annotationStorage.resetModified()
      marksDirty.current = false
      dirtyRef.current = false
      setDirty(false)
      useStore.getState().setDirty(bufferId, false)
      // What is in the file has changed, and the list is a list of what is in
      // the file.
      rereadMarks()
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      useStore
        .getState()
        .showToast(
          message.includes('CONFLICT')
            ? 'This document changed on disk since it was opened, so nothing was written'
            : 'This document could not be saved',
          'error'
        )
      return false
    } finally {
      setSaving(false)
    }
  }

  // The tab's own save — Ctrl+S, the menu, and the prompt when a dirty tab is
  // closed all arrive here, because a PDF's buffer has no text to write.
  const saveRef = useRef(save)
  // Kept current in an effect rather than during render: the registration below
  // happens once, and it has to reach this render's save, not the first one's.
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    registerSaver(bufferId, () => saveRef.current())
    return () => registerSaver(bufferId, null)
  }, [bufferId])

  /**
   * Let go of the draft when this tab closes without saving.
   *
   * Unless another pane is showing the same document: the draft belongs to the
   * file, not to the tab, so two views of one PDF share it — and closing one of
   * them must not take the other's unsaved work away.
   */
  useEffect(() => {
    if (!path) return
    registerCloser(bufferId, () => {
      const elsewhere = Object.values(useStore.getState().buffers).some(
        (buffer) => buffer.id !== bufferId && buffer.filePath === path
      )
      if (!elsewhere) void invoke('pdf:discard', { path })
    })
    return () => registerCloser(bufferId, null)
  }, [bufferId, path])

  /**
   * Carry out a rearrangement of the pages.
   *
   * Anything pdf.js is holding is folded in first: the rearrangement is applied
   * to the document as a whole, and losing an annotation because somebody
   * rotated a page afterwards would be a hard thing to explain.
   *
   * The document is then read again, because the one it was showing has a
   * different shape now. Nothing is written — Ctrl+S is still what does that.
   */
  const applyPlan = async (plan: PagePlan): Promise<void> => {
    if (!path || !(await stage())) return
    try {
      await invoke('pdf:pages', { path, plan })
      changed()
      useStore.getState().showToast('The pages were rearranged — Ctrl+S to save', 'success')
    } catch {
      useStore.getState().showToast('Those pages could not be rearranged', 'error')
    }
  }

  /**
   * Rebuild this document from itself and another one.
   *
   * The same path as any other rearrangement — one plan, one change — with the
   * second document named as a further source.
   */
  const mergeIn = async (other: string, plan: PagePlan): Promise<void> => {
    if (!path || !(await stage())) return
    try {
      await invoke('pdf:pages', { path, plan, also: [other] })
      changed()
      useStore.getState().showToast('Those pages were added — Ctrl+S to save', 'success')
    } catch {
      useStore.getState().showToast('Those pages could not be added', 'error')
    }
  }

  /**
   * Write some pages out as a document of their own, beside this one.
   *
   * The one page operation that does touch the disk, because it makes a file
   * rather than changing this one — and what it writes is what you can see,
   * unsaved changes included, which is why the marks are folded in first.
   */
  const extract = async (plan: PagePlan): Promise<void> => {
    if (!path || !(await stage())) return
    const saveAs = `${path.replace(/\.pdf$/i, '')} extract.pdf`
    try {
      // Main picks a free name rather than overwriting: extracting twice is a
      // thing people do, and the second one must not eat the first.
      const result = await invoke('pdf:extractPages', { path, plan, saveAs })
      await useStore.getState().refreshTree()
      useStore.getState().showToast(`Saved as ${basename(result.path)}`, 'success')
    } catch {
      useStore.getState().showToast('Those pages could not be extracted', 'error')
    }
  }

  /**
   * Step the document back, or forward again.
   *
   * The engine rewrites the whole document for every change, so undo is not a
   * stack of edits in memory: main keeps what the bytes were and puts them
   * back. It puts them back into the draft, so taking back a change that was
   * never written does not become the thing that writes one — and stepping past
   * the last save leaves the tab with something to save again, which is exactly
   * what it now has.
   */
  const step = async (direction: 'undo' | 'redo'): Promise<boolean> => {
    if (!path || !(await stage())) return false
    try {
      const result = await invoke('pdf:undo', { path, direction })
      // Nothing of this document's own to step through: the keystroke is left
      // alone so pdf.js's annotation editor can have it.
      if (!result) return false
      setSteps({ undo: result.undo, redo: result.redo })
      changed()
      return true
    } catch {
      useStore.getState().showToast('That change could not be taken back', 'error')
      return false
    }
  }

  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  })
  useEffect(() => {
    registerUndo(bufferId, {
      undo: () => stepRef.current('undo'),
      redo: () => stepRef.current('redo')
    })
    return () => registerUndo(bufferId, null)
  }, [bufferId])

  // What can be stepped, asked whenever the document is (re)read — and with it,
  // whether main is holding changes this tab has not made itself. It will be,
  // when a second pane opens a document somebody is already editing: what that
  // pane is shown is the draft, so its tab has to carry the dot too.
  useEffect(() => {
    if (!path) return
    let live = true
    void invoke('pdf:canUndo', { path })
      .then((can) => {
        if (!live) return
        setSteps(can)
        if (!can.drafted) return
        dirtyRef.current = true
        setDirty(true)
        useStore.getState().setDirty(bufferId, true)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path, reloadToken, bufferId])

  /**
   * Ctrl+Z here, rather than through the application's keymap.
   *
   * The editor's undo belongs to CodeMirror and only fires while a text
   * document has focus. This surface has focus instead, so it takes the
   * keystroke itself — and only when there is something to undo, so a document
   * nobody has changed does not swallow it.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const direction = event.shiftKey ? 'redo' : 'undo'
      if (!steps[direction]) return
      event.preventDefault()
      void stepRef.current(direction)
    }
    const host = rootRef.current
    host?.addEventListener('keydown', onKey)
    return () => host?.removeEventListener('keydown', onKey)
  }, [steps])

  /**
   * Put a picture on the page.
   *
   * Not pdf.js's stamp tool, which its viewer components cannot drive: they
   * have no way to choose a file, so the button armed and clicking the page did
   * nothing at all. This adds a real image object instead — part of the page
   * like the words around it, drawn by every reader, and taken away by the same
   * undo as everything else.
   *
   * Added to the document, not to the file. Putting a picture down used to
   * write it straight to disk, which meant a picture placed to see how it
   * looked was already in somebody's document before they had decided.
   */
  const addImage = async (): Promise<void> => {
    if (!path || !doc) return
    try {
      const file = await invoke('dialog:pickImage', undefined)
      if (!file) return
      if (!(await stage())) return

      const pdfPage = await doc.getPage(page)
      const view = pdfPage.view as number[]
      const pageWidth = (view[2] ?? 612) - (view[0] ?? 0)
      const pageHeight = (view[3] ?? 792) - (view[1] ?? 0)
      // A third of the page across, in the middle of it: somewhere visible to
      // drag from, rather than a guess at what size was wanted.
      const width = pageWidth / 3
      const height = width
      await invoke('pdf:addImage', {
        path,
        page: page - 1,
        image: file,
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height
      })
      // Turn the page editor on with it. The picture is a page object, so the
      // handles that move, resize and turn it live there — and telling somebody
      // to drag something they cannot touch is worse than saying nothing.
      setEditing(true)
      setPickedAt(changed())
      useStore
        .getState()
        .showToast('The picture was added — drag it where you want it, then Ctrl+S', 'success')
    } catch {
      useStore.getState().showToast('That picture could not be added', 'error')
    }
  }

  /** Pick up or put down an annotation tool. */
  const pickTool = async (mode: number): Promise<void> => {
    const view = viewerRef.current
    if (!view) return
    const { api } = await loadPdfjs()
    const next = tool === mode ? api.AnnotationEditorType.NONE : mode
    view.annotationEditorMode = { mode: next }
    setTool(next)
  }

  /**
   * Send what is selected to a note beside the paper.
   *
   * A quotation with a link back to the page is the thing that makes a PDF part
   * of a knowledge base rather than a file sitting next to one, and doing it by
   * hand — copy, paste, tidy the column breaks, write down the page — is
   * tedious enough that nobody keeps it up.
   *
   * The note is named after the document and lives beside it, so a paper and
   * what you thought about it stay together.
   */
  const quoteSelection = async (): Promise<void> => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!text || !path) return

    // Which page the selection started on, read off the page it is inside
    // rather than from the scroll position, which may have moved since.
    const node = selection?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const onPage = element?.closest<HTMLElement>('.page')
    const pageNumber = Number(onPage?.dataset['pageNumber'] ?? page) || page

    const notePath = `${path.replace(/\.pdf$/i, '')}.md`
    const quote = quoteFromPdf(text, basename(path), pageNumber)
    try {
      await invoke('fs:ensureFile', {
        path: notePath,
        content: `# ${stem(path)}\n\nNotes on [[${basename(path)}]].\n\n`
      })
      const file = await invoke('fs:readFile', { path: notePath })
      await invoke('fs:writeFile', {
        path: notePath,
        content: `${file.content.replace(/\s*$/, '')}\n\n${quote}`,
        expectedMtimeMs: file.mtimeMs
      })
      await useStore.getState().openPaths([notePath])
      useStore.getState().showToast(`Quoted to ${basename(notePath)}`, 'success')
    } catch {
      useStore.getState().showToast('That quote could not be saved', 'error')
    }
  }

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
    if (!view) return
    const next = (view.pagesRotation + 90) % 360
    view.pagesRotation = next
    setRotation(next)
    // Written down with the page and the zoom, so a document comes back the way
    // it was left rather than upright.
    lastSeen.set(path, {
      page: view.currentPageNumber,
      scale: String(view.currentScaleValue ?? 'auto'),
      rotation: next
    })
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
    // `tabIndex` so the surface can hear Ctrl+Z: without it the keystroke has
    // nowhere to land when the pages, rather than an input, have focus.
    <div className="pdfv" ref={rootRef} tabIndex={-1}>
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
        <span className="pdfv__tools">
          {TOOLS.map((entry) => (
            <button
              key={entry.mode}
              className={`pdfv__action${tool === entry.mode ? ' pdfv__action--active' : ''}`}
              aria-label={entry.label}
              aria-pressed={tool === entry.mode}
              title={`${entry.label} — click again to put it down`}
              onClick={() => void pickTool(entry.mode)}
            >
              <Icon name={entry.icon} size={13} />
            </button>
          ))}
          <button
            className="pdfv__action"
            aria-label="Image"
            title="Put a picture on this page"
            onClick={() => void addImage()}
          >
            <Icon name="image" size={13} />
          </button>
        </span>

        <button
          className={`pdfv__action${editing ? ' pdfv__action--active' : ''}`}
          aria-label="Edit the page itself"
          aria-pressed={editing}
          title="Change the words and pictures on the page, rather than writing on top of them"
          onClick={() => setEditing((on) => !on)}
        >
          <Icon name="sliders" size={13} />
        </button>

        <button
          className="pdfv__action"
          aria-label="Undo"
          title="Take back the last change (Ctrl+Z)"
          disabled={!steps.undo}
          onClick={() => void step('undo')}
        >
          <Icon name="undo" size={13} />
        </button>
        <button
          className="pdfv__action"
          aria-label="Redo"
          title="Make that change again (Ctrl+Shift+Z)"
          disabled={!steps.redo}
          onClick={() => void step('redo')}
        >
          <Icon name="redo" size={13} />
        </button>

        <button
          className="pdfv__action"
          aria-label="Save this document"
          title="Write the changes back into the file (Ctrl+S)"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          <Icon name="download" size={13} />
          <span className="pdfv__ocr-label">{dirty ? 'Save' : 'Saved'}</span>
        </button>

        {emptyPages.length > 0 && (
          <button
            className="pdfv__action"
            aria-label="Recognise the text on scanned pages"
            title={`${emptyPages.length} page${emptyPages.length === 1 ? '' : 's'} here have no text. Read them?`}
            disabled={reading !== null}
            onClick={() => void recognise()}
          >
            <Icon name="eye" size={13} />
            <span className="pdfv__ocr-label">{reading ?? 'Recognise text'}</span>
          </button>
        )}
        <button
          className="pdfv__action"
          aria-label="Quote the selection into a note"
          title="Send the selected text to a note beside this document"
          onClick={() => void quoteSelection()}
        >
          <Icon name="quote" size={13} />
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
            marks={marks}
            unsaved={dirty}
            onGoToPage={goToPage}
            onGoToDestination={(dest) => void linksRef.current?.goToDestination(dest)}
            onApplyPlan={applyPlan}
            onExtract={extract}
            onMerge={mergeIn}
          />
        )}
        {/* pdf.js measures against its container and refuses to run unless that
            container is absolutely positioned — so it is, inside a host the
            layout can size normally. Positioning it against the whole body
            instead meant hard-coding the rail's width, and the tab that did not
            fit ended up underneath the pages. */}
        <div className="pdfv__scroll-host">
          <div className="pdfv__scroll" ref={scrollRef}>
            <div className="pdfViewer" ref={pagesRef} />
            {editing && doc && path && (
              <PdfObjectLayer
                key={`${page}:${rotation}:${reloadToken}`}
                doc={doc}
                path={path}
                page={page}
                alphabet={alphabet}
                rotation={rotation}
                pickAdded={pickedAt === reloadToken}
                beforeEdit={stage}
                onChanged={changed}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
