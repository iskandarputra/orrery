import { protocol } from 'electron'

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
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/** After ready: answer with the page the renderer put there, and its policy. */
export function handlePreviewProtocol(): void {
  protocol.handle(PREVIEW_SCHEME, (request) => {
    let id: string
    try {
      id = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const page = pages.get(id)
    if (!page) return new Response('No page', { status: 404 })

    return new Response(page.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': page.policy,
        // Nothing here is worth keeping, and a stale copy of a document being
        // edited is worse than none: every render puts the current text.
        'Cache-Control': 'no-store'
      }
    })
  })
}
