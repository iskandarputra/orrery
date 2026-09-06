/**
 * The one script that runs inside a page being read, and why there is one.
 *
 * Rebuilding the reader used to mean navigating the frame to a fresh address,
 * which reloads the document and puts it back at the top. Editing an HTML file
 * in a split pane therefore scrolled the preview to the top every quarter
 * second, and there is no way to fix that from outside: keeping a reader's
 * place means reading and setting a scroll offset *inside* the document, and
 * the frame is a different origin.
 *
 * `postMessage` crosses that origin — it is what the API is for. What it cannot
 * do is run anything, so something in the page has to listen. This is that
 * something, and it is the same arrangement a VS Code webview uses: the host
 * serves a script of its own from a scheme the document cannot write to, names
 * only that script in `script-src`, and leaves `'unsafe-inline'` out. The
 * host's code runs; the document's does not.
 *
 * **What this costs, stated plainly.** The frame now carries `allow-scripts`
 * whether or not the reader has agreed to run the page's code, because this
 * script has to run either way. Before, a page's own JavaScript was refused
 * twice over — by an empty `sandbox` and by a policy naming no script source —
 * and now it is refused once, by the policy. The containment boundary is
 * untouched: no `allow-same-origin`, so the page is still an opaque origin that
 * cannot reach the app, its storage or its bridge, and `e2e/html-reader`
 * proves that against a page that tries. What moved is only the second lock on
 * a door the first lock still holds.
 *
 * Kept as a string rather than a file so it cannot drift from the policy that
 * admits it, and so the whole of what runs in an untrusted document is legible
 * in one place.
 */

/**
 * Where the script is served.
 *
 * A host of its own, not a path under the pages: `orrery-preview://reader/…`
 * parses to host `reader`, which is what keeps it a separate branch from
 * `orrery-preview://page/<id>` and out of reach of anything the store holds.
 */
export const READER_HOST = 'reader'
export const READER_FILE = '/reader.js'

/**
 * The exact URL, which is also the CSP source.
 *
 * A path, not just a scheme: `script-src orrery-preview:` would admit any
 * document held in the preview store, including another buffer's page. Naming
 * the file admits the file.
 */
export const readerScriptUrl = (scheme: string): string =>
  `${scheme}://${READER_HOST}${READER_FILE}`

/** What the app sends in; what the page sends back. */
export const READY = 'orrery:reader-ready'
export const UPDATE = 'orrery:reader-update'

/**
 * Replace the document in place, keeping where the reader was.
 *
 * Written as a string of plain ES2020 with no bundling step. It does four
 * things and must never grow a fifth without a reason as good as this one's:
 *
 *  - say it is ready, so the app patches instead of reloading;
 *  - take a new document, adopt its head and body, and put the scroll back;
 *  - refuse a message from anywhere but the app;
 *  - nothing else. It reads no page content and sends none back — the app
 *    already has the source, so a reader that reported anything about the
 *    document would be a channel out of a sandbox for no gain.
 *
 * Scripts in the incoming document do not run: nodes parsed by `DOMParser` and
 * inserted are not executable, and the policy would refuse them anyway. That is
 * why a page whose own code *has* been allowed is reloaded rather than patched
 * — its scripts are supposed to run again, and patching would silently stop
 * them.
 */
export const READER_SCRIPT = `(function () {
  'use strict'
  var parentWindow = window.parent
  if (!parentWindow || parentWindow === window) return

  // Captured before the document can be replaced, so a page cannot arrange for
  // a later swap to call something of its own choosing.
  var scrollTo = window.scrollTo.bind(window)
  var parse = function (html) {
    return new DOMParser().parseFromString(html, 'text/html')
  }

  window.addEventListener('message', function (event) {
    // Only the app. The origin is opaque on both sides, so identity is the
    // window itself rather than a string.
    if (event.source !== parentWindow) return
    var data = event.data
    if (!data || data.type !== ${JSON.stringify(UPDATE)} || typeof data.html !== 'string') return

    var x = window.scrollX
    var y = window.scrollY
    var next = parse(data.html)
    document.documentElement.replaceChild(document.adoptNode(next.head), document.head)
    document.documentElement.replaceChild(document.adoptNode(next.body), document.body)
    // Once now, and once after layout: the new body has no height yet on this
    // turn, so an offset past the old end would otherwise be clamped away.
    scrollTo(x, y)
    requestAnimationFrame(function () {
      scrollTo(x, y)
    })
  })

  parentWindow.postMessage({ type: ${JSON.stringify(READY)} }, '*')
})()
`
