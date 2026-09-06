import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { PAGE_SCHEME, parsePageAssetUrl, resolveUnderRoot } from '@core/preview-asset'
import { READER_FILE, READER_HOST, READER_SCRIPT, readerScriptUrl } from '@core/preview-reader'

export const PREVIEW_SCHEME = 'orrery-preview'

/**
 * The page the HTML reader is showing, served as a document of its own.
 *
 * The reader used to hand the frame a `srcdoc`, which works until the page
 * needs to run. A `srcdoc` document inherits the Content-Security-Policy of the
 * page embedding it and the two intersect, so the frame can only ever be
 * *more* restricted than the app — and the app forbids inline script, as it
 * should. There is no arrangement of the frame that lets a page run its own
 * code without first loosening the app's own policy, which is the wrong trade
 * by a wide margin.
 *
 * A document fetched over a scheme of its own has no such inheritance: it
 * carries whatever policy its response says, and the app's stays exactly as
 * strict as it was. So the page is served from here, the policy travels with
 * it, and "run this page's scripts" becomes one header on one response rather
 * than a permission the whole application gains.
 *
 * Two more things fall out of it, both of which the `srcdoc` version had to
 * work around. The document has a real URL, so `href="#section"` resolves to
 * this document and scrolls instead of being a navigation nothing allows. And
 * the policy is a header, so it is never something the page's own markup could
 * be mistaken for.
 *
 * What is served is held in memory and only ever put there by the renderer,
 * which is showing it. Nothing is read from disk here: a request for a page
 * nobody is looking at has nothing to return.
 */

interface Page {
  html: string
  /** The full `Content-Security-Policy` for this page, built by the renderer. */
  policy: string
  /**
   * The one folder this page may read files out of, or null for none at all.
   *
   * Decided by `core/preview-asset`, and the only thing standing between a
   * document nobody vouched for and the rest of the disk. It is held here
   * rather than sent with each request because a request is written by the
   * page: anything the frame could put in a URL, a hostile page could put in a
   * URL too.
   */
  root: string | null
}

const pages = new Map<string, Page>()

/** Hold a page for the frame about to ask for it. Returns the URL to point at. */
export function putPreview(id: string, page: Page): string {
  pages.set(id, page)
  return `${PREVIEW_SCHEME}://page/${encodeURIComponent(id)}`
}

/** The reader has gone; nothing should be able to fetch this any more. */
export function dropPreview(id: string): void {
  pages.delete(id)
}

/**
 * The renderer went away, so every page it was showing did too.
 *
 * Buffer ids die with the window that made them, and a page nobody is looking
 * at is exactly what this must not keep — a reload used to leave the whole set
 * behind, readable for as long as the app ran, under ids the new renderer
 * would never ask for and could not clear.
 */
export function dropAllPreviews(): void {
  pages.clear()
}

/**
 * Must run before app `ready`.
 *
 * `standard` so the URL parses into an origin the frame can be given, and
 * `secure` so it is not treated as a downgrade by the page embedding it.
 * Deliberately without `supportFetchAPI` or `corsEnabled`: this scheme exists
 * to be *navigated to* by one frame, and a page that could `fetch()` its own
 * source back is a capability nothing here needs.
 */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } },
    // The files a page may load, on a scheme of their own. Same restraint: it
    // is fetched as a subresource by one frame and nothing more, so neither
    // `supportFetchAPI` nor `corsEnabled` — a page that could read back the
    // bytes of what it names is the capability this exists to withhold.
    { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/**
 * The app's own script, added to every page as it is served.
 *
 * Here rather than in the renderer's rewrite for two reasons. The counting in
 * `buildPreview` reads the document for `<script`, and a tag the app added
 * would make every page in the world report that it has scripts. And a page
 * cannot be served without it: there is one place that answers for this scheme,
 * so there is one place the reader can go missing from.
 *
 * Appended at the very end. An HTML parser moves a trailing script into the
 * body, and running last is what this wants anyway.
 */
function withReader(html: string): string {
  return `${html}\n<script src="${readerScriptUrl(PREVIEW_SCHEME)}"></script>\n`
}

/** After ready: answer with the page the renderer put there, and its policy. */
export function handlePreviewProtocol(): void {
  protocol.handle(PREVIEW_SCHEME, (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    // Two branches on the host, and nothing else answers. The reader's script
    // is not a page, and must not be reachable by asking for one.
    if (url.host === READER_HOST) {
      if (url.pathname !== READER_FILE) return new Response('Not found', { status: 404 })
      return new Response(READER_SCRIPT, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      })
    }

    let id: string
    try {
      id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const page = pages.get(id)
    if (!page) return new Response('No page', { status: 404 })

    return new Response(withReader(page.html), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': page.policy,
        // Nothing here is worth keeping, and a stale copy of a document being
        // edited is worse than none: every render puts the current text.
        'Cache-Control': 'no-store',
        // Nothing a page fetches says where it was fetched from. The frame is
        // an opaque origin so there is little to leak, but "little" is not the
        // promise the reader makes about a page's remote content.
        'Referrer-Policy': 'no-referrer'
      }
    })
  })
}

/**
 * After ready: the files a page is allowed to load, and no others.
 *
 * The address a page asks with names the page and a path *inside that page's
 * root* — never a path on the disk. So the worst a hostile document can write
 * is a request for a file under the folder its own file was opened from, which
 * is the same thing as asking for a file it could have shipped beside itself.
 *
 * Refusals are all 404, deliberately: a page that could tell "not allowed"
 * from "not there" would have a way to ask questions about the disk, which is
 * most of what confining it was for.
 */
export function handlePageAssetProtocol(): void {
  protocol.handle(PAGE_SCHEME, async (request) => {
    const missing = new Response('Not found', { status: 404 })

    const asked = parsePageAssetUrl(request.url)
    if (!asked) return missing

    const page = pages.get(asked.id)
    if (!page?.root) return missing

    const filePath = resolveUnderRoot(page.root, asked.relative)
    if (!filePath) return missing

    try {
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return missing
    }
  })
}
