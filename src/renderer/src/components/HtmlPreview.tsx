import { useEffect, useRef, useState } from 'react'
import { buildPreview, type PreviewDocument } from '@core/html-document'
import { preparePage } from '@/editor/html-page'
import { viewForBuffer } from '@/editor/active-view'
import { useDocVersion } from '@/state/doc-version'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'

/**
 * An HTML file, read as the page it is.
 *
 * The editor already opens one — as source, highlighted, which is the right
 * answer for changing it and no answer at all for looking at it. This is the
 * other half: the same buffer, rendered, switched to and back without the file
 * leaving the editor it is open in. Read mode is a way of looking at the
 * document, not a different document, so the source stays loaded behind it with
 * its history, its cursor and its unsaved changes intact.
 *
 * It renders what is *in the buffer*, not what is on disk. Editing a page and
 * pressing Read shows the edit; a preview that showed the last saved version
 * would make every change a save-and-check, which is the loop the split exists
 * to avoid.
 *
 * What it is allowed to render, and why an untrusted document can be rendered
 * at all, is set out in `core/html-document`. The two things this file must get
 * right are on the iframe below: an empty `sandbox`, and a `srcdoc` that came
 * from `buildPreview`.
 */

/** How long after the last change before the page is rebuilt. */
const REBUILD_DELAY = 250

export function HtmlPreview({ bufferId }: { bufferId: string }): React.JSX.Element {
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const filePath = useStore((s) => s.buffers[bufferId]?.filePath ?? null)
  const allowRemote = useStore((s) => !!s.htmlRemote[bufferId])
  const allowHtmlRemote = useStore((s) => s.allowHtmlRemote)
  const setHtmlReading = useStore((s) => s.setHtmlReading)

  /** null until the pane's editor has been found and read. */
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Read the document once the pane has an editor holding it.
   *
   * A pane registers its view in an effect, and a child's effects run first, so
   * reading during render finds nothing. Unlike the surfaces that write back,
   * the cost of getting this wrong is only a blank page — but a blank page that
   * looks like an empty file is its own kind of wrong.
   */
  useEffect(() => {
    let live = true
    let frame = 0

    const attempt = (tries: number): void => {
      if (!live) return
      const view = viewForBuffer(bufferId)
      if (!view) {
        if (tries > 120) {
          setFailed(true)
          return
        }
        frame = requestAnimationFrame(() => attempt(tries + 1))
        return
      }
      setSource(view.state.doc.toString())
    }
    frame = requestAnimationFrame(() => attempt(0))
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [bufferId])

  /**
   * Follow the document: an edit in a split pane, an undo, a reload from disk.
   *
   * Debounced, because handing an iframe a new `srcdoc` reloads it from the
   * top. Rebuilding on the keystroke would put the reader back at the top of
   * the page for every character typed next door.
   */
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const view = viewForBuffer(bufferId)
      if (!view) return
      setSource((current) => {
        const next = view.state.doc.toString()
        return next === current ? current : next
      })
    }, REBUILD_DELAY)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [version, bufferId])

  /**
   * The prepared page, which is not something a render can work out.
   *
   * Drawing the diagrams and typesetting the equations means loading mermaid
   * and KaTeX and waiting for them, so the page arrives after the render that
   * asked for it. Until it does the reader shows the frame it already had,
   * rather than blanking: re-reading a page you are looking at should not make
   * it disappear and come back.
   */
  const [page, setPage] = useState<
    (PreviewDocument & { diagrams: number; equations: number }) | null
  >(null)

  useEffect(() => {
    if (source === null) return
    let live = true
    void (async () => {
      const prepared = await preparePage(source, filePath)
      if (!live) return
      setPage({ ...buildPreview(prepared.html, { allowRemote }), ...prepared })
    })()
    return () => {
      live = false
    }
  }, [source, filePath, allowRemote])

  if (failed) {
    return (
      <div className="htmlv">
        <EmptyState icon="alert-triangle">That page could not be read.</EmptyState>
      </div>
    )
  }

  return (
    <div className="htmlv">
      <div className="htmlv__bar">
        <span className="htmlv__mode">
          <Icon name="eye" size={12} />
          Reading
        </span>

        {page && page.diagrams > 0 && (
          <span
            className="htmlv__note"
            title="Drawn by this app from the page's own source, without running the page's code"
          >
            <Icon name="diagram" size={12} />
            {page.diagrams} diagram{page.diagrams === 1 ? '' : 's'} drawn
          </span>
        )}
        {page && page.equations > 0 && (
          <span
            className="htmlv__note"
            title="Typeset by this app from the page's own TeX, without running the page's code"
          >
            <Icon name="math" size={12} />
            {page.equations} equation{page.equations === 1 ? '' : 's'} typeset
          </span>
        )}

        {page?.hasScripts && (
          <span className="htmlv__note" title="Nothing in this page is executed while you read it">
            <Icon name="alert-triangle" size={12} />
            Scripts are not run
          </span>
        )}

        {page && page.remoteCount > 0 && !allowRemote && (
          <button
            className="htmlv__action"
            onClick={() => allowHtmlRemote(bufferId)}
            title="Fetch the pictures this page links to from the internet"
          >
            <Icon name="image" size={12} />
            Load {page.remoteCount} remote {page.remoteCount === 1 ? 'item' : 'items'}
          </button>
        )}
        {allowRemote && (
          <span className="htmlv__note" title="This page may fetch pictures from the internet">
            <Icon name="image" size={12} />
            Remote content loaded
          </span>
        )}

        <button
          className="htmlv__action htmlv__action--end"
          onClick={() => setHtmlReading(bufferId, false)}
          title="Back to the source (Ctrl+Shift+V)"
        >
          <Icon name="pencil" size={12} />
          Edit
        </button>
      </div>

      {page === null ? (
        <EmptyState icon="file-text">Opening the page…</EmptyState>
      ) : (
        <iframe
          className="htmlv__frame"
          title="Page preview"
          // The boundary. An empty sandbox is an opaque origin with no
          // scripting, no forms, no downloads and no way to navigate the window
          // around it — every token that would give any of that back is a token
          // this attribute must never gain. `srcdoc` keeps the document a
          // string this process built rather than a URL something else can
          // point somewhere; the policy it carries is `buildPreview`'s.
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={page.srcdoc}
        />
      )}
    </div>
  )
}
