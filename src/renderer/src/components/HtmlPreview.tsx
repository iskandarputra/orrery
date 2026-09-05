import { useEffect, useRef, useState } from 'react'
import { buildPreview } from '@core/html-document'
import { preparePage } from '@/editor/html-page'
import { invoke } from '@/services/client'
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
 * right are on the iframe below: a `sandbox` that never gains a token beyond
 * `allow-scripts`, and an address that came from `preview:put` — so the page
 * is fetched as a document of its own, under the policy `buildPreview` built
 * for it. See `main/preview-protocol`.
 */

/** How long after the last change before the page is rebuilt. */
const REBUILD_DELAY = 250

export function HtmlPreview({ bufferId }: { bufferId: string }): React.JSX.Element {
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const filePath = useStore((s) => s.buffers[bufferId]?.filePath ?? null)
  const allowRemote = useStore((s) => !!s.htmlRemote[bufferId])
  const allowHtmlRemote = useStore((s) => s.allowHtmlRemote)
  const allowScripts = useStore((s) => !!s.htmlScripts[bufferId])
  const allowHtmlScripts = useStore((s) => s.allowHtmlScripts)
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
   * Debounced, because a rebuilt page is a fresh address and the frame loads
   * it from the top. Rebuilding on the keystroke would put the reader back at
   * the top of the page for every character typed next door.
   *
   * It only makes that rarer, it does not fix it: a rebuild still loses the
   * reader's place. Keeping it would mean telling the frame where to scroll
   * back to, and the frame is an opaque origin this process cannot speak to —
   * which is the same property that makes showing the page safe at all. So the
   * cost is real and it is the one being paid on purpose.
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
  const [page, setPage] = useState<{
    url: string
    hasScripts: boolean
    remoteCount: number
    diagrams: number
    equations: number
  } | null>(null)

  useEffect(() => {
    if (source === null) return
    let live = true
    void (async () => {
      const prepared = await preparePage(source, filePath)
      if (!live) return
      const built = buildPreview(prepared.html, { allowRemote, allowScripts })
      // Handed to the main process and fetched back over a scheme of its own,
      // rather than inlined: a served document carries its own policy, and
      // that is the only way this page can be allowed to run its own code
      // without the application relaxing the policy it holds itself to.
      const url = await invoke('preview:put', {
        id: bufferId,
        html: built.html,
        policy: built.policy
      })
      if (!live) return
      // A fresh query each time, so the frame reloads even though the address
      // has not changed — the same buffer keeps the same id for its lifetime.
      setPage({
        url: `${url}?v=${Date.now()}`,
        hasScripts: built.hasScripts,
        remoteCount: built.remoteCount,
        diagrams: prepared.diagrams,
        equations: prepared.equations
      })
    })()
    return () => {
      live = false
    }
  }, [source, filePath, allowRemote, allowScripts, bufferId])

  // The page is held in the main process for as long as something is showing
  // it. Nothing should be able to fetch a document nobody is reading.
  useEffect(() => () => void invoke('preview:drop', { id: bufferId }), [bufferId])

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

        {page?.hasScripts &&
          (allowScripts ? (
            <span
              className="htmlv__note htmlv__note--live"
              title="This page's own code is running, in a frame that cannot reach the app"
            >
              <Icon name="zap" size={12} />
              Scripts are running
            </span>
          ) : (
            <button
              className="htmlv__action"
              onClick={() => allowHtmlScripts(bufferId)}
              title="Run this page's own scripts. It stays in a frame with no access to the app, and nothing is fetched from the internet."
            >
              <Icon name="zap" size={12} />
              Run scripts
            </button>
          ))}

        {page && page.remoteCount > 0 && !allowRemote && (
          <button
            className="htmlv__action"
            onClick={() => allowHtmlRemote(bufferId)}
            title="Fetch the pictures, stylesheets and webfonts this page links to from the internet. Its own code is never fetched, whatever else is allowed."
          >
            <Icon name="image" size={12} />
            Load {page.remoteCount} remote {page.remoteCount === 1 ? 'item' : 'items'}
          </button>
        )}
        {allowRemote && (
          <span
            className="htmlv__note"
            title="This page may fetch pictures, stylesheets and webfonts from the internet"
          >
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
          // The boundary. A sandbox with no tokens is an opaque origin with no
          // scripting, no forms, no downloads and no way to navigate the window
          // around it. `allow-scripts` is the only token ever added, and never
          // alongside `allow-same-origin`: together they would let the page
          // reach out of its own opaque origin, which is the whole of what
          // keeps it contained. Without scripting there is not even that.
          //
          // The address is one `preview:put` returned, so the document is
          // fetched rather than inlined and arrives under its own policy —
          // the reason a page can be allowed to run its own code without the
          // application relaxing the policy it holds itself to.
          sandbox={allowScripts ? 'allow-scripts' : ''}
          referrerPolicy="no-referrer"
          src={page.url}
        />
      )}
    </div>
  )
}
