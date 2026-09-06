import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { buildPreview } from '@core/html-document'
import { fingerprint, trustedFor } from '@core/html-trust'
import { previewRoot } from '@core/preview-asset'
import { READY, UPDATE } from '@core/preview-reader'
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

/** How often to look again for a pane that has not produced its editor yet. */
const WATCH_DELAY = 500

export function HtmlPreview({ bufferId }: { bufferId: string }): React.JSX.Element {
  const version = useDocVersion((v) => v[bufferId] ?? 0)
  const filePath = useStore((s) => s.buffers[bufferId]?.filePath ?? null)
  const vaultRoot = useStore((s) => s.rootPath)
  const allowRemote = useStore((s) => !!s.htmlRemote[bufferId])
  const allowHtmlRemote = useStore((s) => s.allowHtmlRemote)
  const stopHtmlRemote = useStore((s) => s.stopHtmlRemote)
  const allowScripts = useStore((s) => !!s.htmlScripts[bufferId])
  const allowHtmlScripts = useStore((s) => s.allowHtmlScripts)
  const stopHtmlScripts = useStore((s) => s.stopHtmlScripts)
  const rememberHtmlTrust = useStore((s) => s.rememberHtmlTrust)
  const setHtmlReading = useStore((s) => s.setHtmlReading)
  const isDirty = useStore((s) => !!s.buffers[bufferId]?.isDirty)

  /** null until the pane's editor has been found and read. */
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** The app's own script in the frame has said it is listening. */
  const readyRef = useRef(false)

  /**
   * Read the document once the pane has an editor holding it.
   *
   * A pane registers its view in an effect, and a child's effects run first, so
   * reading during render finds nothing. Unlike the surfaces that write back,
   * the cost of getting this wrong is only a blank page — but a blank page that
   * looks like an empty file is its own kind of wrong.
   *
   * Giving up after two seconds says so, and then keeps looking. A view that
   * turns up late is a page that can still be read, and the alternative was a
   * dead end: the message stayed until the reader was closed and opened again,
   * because nothing ever cleared it.
   */
  useEffect(() => {
    let live = true
    let frame = 0
    let watch: ReturnType<typeof setInterval> | null = null

    const take = (view: EditorView): void => {
      setFailed(false)
      setSource(view.state.doc.toString())
    }

    const attempt = (tries: number): void => {
      if (!live) return
      const view = viewForBuffer(bufferId)
      if (view) {
        take(view)
        return
      }
      if (tries > 120) {
        setFailed(true)
        watch = setInterval(() => {
          const late = live ? viewForBuffer(bufferId) : null
          if (!late) return
          if (watch) clearInterval(watch)
          watch = null
          take(late)
        }, WATCH_DELAY)
        return
      }
      frame = requestAnimationFrame(() => attempt(tries + 1))
    }
    frame = requestAnimationFrame(() => attempt(0))
    return () => {
      live = false
      cancelAnimationFrame(frame)
      if (watch) clearInterval(watch)
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
   * reader's place.
   *
   * Not because the frame is unreachable — `postMessage` crosses an opaque
   * origin perfectly well, which is exactly how a VS Code webview talks to the
   * extension that owns it. It is because keeping the place means running code
   * *inside* the page to report and restore it, and this reader's whole premise
   * is that a document nobody vouched for runs nothing at all.
   *
   * There is a way to have both, and it is the one VS Code takes: serve a small
   * script of the app's own from a scheme the document cannot write to, name
   * only that scheme in `script-src`, and leave `'unsafe-inline'` out — the
   * app's script runs, the page's does not. Then updates arrive over
   * `postMessage` and the page is patched in place rather than reloaded, which
   * is why a markdown preview there keeps its scroll and this does not. It is a
   * real design, deliberately not taken yet: it puts app code inside the frame
   * and makes the reader a two-way channel, and that is a larger promise than
   * "we show you the file".
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
    scripts: number
    remoteCount: number
    diagrams: number
    equations: number
  } | null>(null)

  useEffect(() => {
    if (source === null) return
    let live = true
    void (async () => {
      /**
       * What this file was allowed to do the last time it was open, if it is
       * still the same file. See `core/html-trust`.
       *
       * Read out of the store rather than subscribed to, on purpose. A
       * subscription would make recording a consent a reason to rebuild, and a
       * rebuild with scripts running is a reload: pressing Run would show the
       * page, write the consent, and then load the page a second time.
       */
      const digest = await fingerprint(source)
      if (!live) return
      const granted = trustedFor(useStore.getState().settings.htmlTrust, filePath, digest)
      if ((granted.scripts && !allowScripts) || (granted.remote && !allowRemote)) {
        // Taking the offer up is what this effect builds from, so let it run
        // again with the consent in place instead of building the page twice.
        if (granted.scripts) allowHtmlScripts(bufferId)
        if (granted.remote) allowHtmlRemote(bufferId)
        return
      }

      // The one folder this page may read files out of, settled here and sent
      // with the page so that main — not the page — decides what a request for
      // a file resolves to. See `core/preview-asset`.
      const root = previewRoot(filePath, vaultRoot)
      const prepared = await preparePage(source, { previewId: bufferId, docPath: filePath, root })
      if (!live) return
      const built = buildPreview(prepared.html, { allowRemote, allowScripts })

      // Recorded on every render rather than where the button is, so that the
      // digest follows a file whose author is editing it, and so withdrawing
      // the last consent clears the row instead of leaving it to be honoured
      // next time. It writes nothing when nothing has changed.
      if (filePath) {
        rememberHtmlTrust(filePath, digest, { scripts: allowScripts, remote: allowRemote })
      }
      // Handed to the main process and fetched back over a scheme of its own,
      // rather than inlined: a served document carries its own policy, and
      // that is the only way this page can be allowed to run its own code
      // without the application relaxing the policy it holds itself to.
      const url = await invoke('preview:put', {
        id: bufferId,
        html: built.html,
        policy: built.policy,
        root,
        // Only for figures the app drew, and only while the page's own code is
        // not running: a page that runs owns its own controls.
        figures: !allowScripts && prepared.diagrams > 0
      })
      if (!live) return

      /**
       * Patch the page the frame is already showing, rather than reloading it.
       *
       * A reload is a navigation and puts the reader back at the top, which is
       * what made editing an HTML file beside its preview unusable. The app's
       * own script is in there listening; handing it the new document lets it
       * swap the head and body and put the scroll back. See
       * `core/preview-reader`.
       *
       * Only when the page's own code is *not* running. A page that has been
       * allowed to run is supposed to run again on a rebuild, and a patched
       * document does not re-execute anything — so that case still reloads,
       * and still loses its place, which is the honest behaviour for it.
       */
      const frame = frameRef.current
      if (!allowScripts && readyRef.current && frame?.contentWindow) {
        frame.contentWindow.postMessage({ type: UPDATE, html: built.html }, '*')
        setPage((current) =>
          current
            ? {
                ...current,
                scripts: built.scripts,
                remoteCount: built.remoteCount,
                diagrams: prepared.diagrams,
                equations: prepared.equations
              }
            : current
        )
        return
      }

      // A fresh query each time, so the frame reloads even though the address
      // has not changed — the same buffer keeps the same id for its lifetime.
      readyRef.current = false
      setPage({
        url: `${url}?v=${Date.now()}`,
        scripts: built.scripts,
        remoteCount: built.remoteCount,
        diagrams: prepared.diagrams,
        equations: prepared.equations
      })
    })()
    return () => {
      live = false
    }
  }, [
    source,
    filePath,
    vaultRoot,
    allowRemote,
    allowScripts,
    bufferId,
    allowHtmlRemote,
    allowHtmlScripts,
    rememberHtmlTrust
  ])

  /**
   * The frame's own reader, saying it is listening.
   *
   * Identity, not origin: the frame is an opaque origin and reports itself as
   * `null`, which any other frame could too. The window it came from is the
   * only thing that distinguishes it.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      if ((event.data as { type?: string } | null)?.type === READY) readyRef.current = true
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

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

        {!!page?.scripts &&
          (allowScripts ? (
            <button
              className="htmlv__action htmlv__action--live"
              onClick={() => stopHtmlScripts(bufferId, filePath)}
              /**
               * A notice until it was also the way back. Consent outlives the
               * tab now, and a permission that can only ever be given is not a
               * permission: this is the whole of the way to take it back, so it
               * has to be where the thing it is about is being said.
               */
              title="This page's own code is running, in a frame that cannot reach the app, and it will run again the next time you open this file. Click to stop it and forget that it was allowed."
            >
              <Icon name="zap" size={12} />
              {page.scripts} script{page.scripts === 1 ? '' : 's'} running
            </button>
          ) : (
            <button
              className="htmlv__action"
              onClick={() => allowHtmlScripts(bufferId)}
              /**
               * The count is the point. A page that draws its own contents
               * rail, its own controls and its own animation with script
               * arrives looking like a page missing its navigation, and the
               * only sign of why was a button that said "Run scripts" without
               * saying anything had been held back.
               */
              title="Run this page's own code. Some pages build their contents rail, their controls or their animation with it, and none of that is there until you do. It stays in a frame with no access to the app, and nothing is fetched from the internet. This file is remembered, so you will not be asked again unless what is in it changes."
            >
              <Icon name="zap" size={12} />
              Run {page.scripts} script{page.scripts === 1 ? '' : 's'}
            </button>
          ))}

        {page && page.remoteCount > 0 && !allowRemote && (
          <button
            className="htmlv__action"
            onClick={() => allowHtmlRemote(bufferId)}
            title="Fetch the pictures, stylesheets and webfonts this page links to from the internet. Its own code is never fetched, whatever else is allowed. This file is remembered, so you will not be asked again unless what is in it changes."
          >
            <Icon name="image" size={12} />
            Load {page.remoteCount} remote {page.remoteCount === 1 ? 'item' : 'items'}
          </button>
        )}
        {allowRemote && (
          <button
            className="htmlv__action"
            onClick={() => stopHtmlRemote(bufferId, filePath)}
            title="This page may fetch pictures, stylesheets and webfonts from the internet, and will again the next time you open this file. Click to stop it and forget that it was allowed."
          >
            <Icon name="image" size={12} />
            Remote content loaded
          </button>
        )}

        {filePath && (
          <button
            className="htmlv__action htmlv__action--end"
            onClick={() => void invoke('shell:openInBrowser', { path: filePath })}
            /**
             * The way out of a reader that withholds most of what a browser
             * does — no remote code, no network, no storage, no navigation, and
             * a light colour scheme whatever the page asked for. When the
             * answer to "why does this not look right" is "because this is not
             * a browser", the useful next step is a browser.
             *
             * It opens what is *on disk*, which is not always what is on
             * screen: the reader shows the buffer. The title says so when those
             * two have come apart, rather than quietly showing an older page.
             */
            title={
              isDirty
                ? 'Open the saved file in your browser. This buffer has unsaved changes, which the browser will not show.'
                : 'Open this file in your browser, with none of the reader’s restrictions'
            }
          >
            <Icon name="external-link" size={12} />
            Browser
          </button>
        )}

        <button
          className={`htmlv__action${filePath ? '' : ' htmlv__action--end'}`}
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
          ref={frameRef}
          className="htmlv__frame"
          title="Page preview"
          // The boundary, and the one line here that must never be got wrong:
          // `allow-scripts` without `allow-same-origin`. Together they would
          // let the page reach out of its own opaque origin, which is the whole
          // of what keeps it contained — no access to the app, its storage, its
          // bridge or its cookies. No other token is ever added.
          //
          // `allow-scripts` is unconditional now, because the app's own reader
          // script has to run whether or not the page's does. Whether the
          // *page's* code runs is decided by `script-src` alone: with the offer
          // untaken the policy names one file, `core/preview-reader`, and
          // nothing the document contains is a script source. That is one lock
          // where there used to be two, on a door the other lock still holds —
          // set out at length in `core/preview-reader`.
          //
          // The address is one `preview:put` returned, so the document is
          // fetched rather than inlined and arrives under its own policy —
          // the reason a page can be allowed to run its own code without the
          // application relaxing the policy it holds itself to.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={page.url}
        />
      )}
    </div>
  )
}
