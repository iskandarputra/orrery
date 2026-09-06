import { extname } from './paths'
import { readerScriptUrl } from './preview-reader'

/**
 * What the reader shows when the document being read is itself HTML.
 *
 * A `.html` file is the one file type the app already knows how to display and
 * refuses to: it opens as source, which is right for editing it and useless for
 * looking at it. Reading mode renders it — and rendering a file somebody
 * downloaded, cloned, or was sent is exactly the thing this app has been
 * careful not to do anywhere else, so the terms are set out here rather than
 * spread through a component.
 *
 * **The document is never trusted.** It is shown in an iframe whose `sandbox`
 * starts with no tokens at all, which puts it in an opaque origin with no
 * scripting, no forms, no navigation of the window around it and no downloads.
 * That alone is the boundary. Everything below is a second one, so that a
 * mistake in either is not a mistake in both.
 *
 * **The policy is a Content-Security-Policy, not a filter.** It travels as a
 * response header on the served document rather than as a `<meta>` in it, so
 * it cannot be confused with the page's own markup and does not depend on
 * where in the document it landed. Notes go through
 * `html-policy`, which keeps an allow-list of tags — the right shape when the
 * HTML is a fragment inside prose and the surrounding page is the app's own.
 * A whole document is a different problem: strip its `<style>` and its `<link>`
 * and what is left is not the file, it is a worse copy of the file, which is
 * not a reader. So the document is delivered whole and the browser is told what
 * it may load. Scripts do not run because nothing grants them, not because a
 * regular expression went looking for `<script>`.
 *
 * **The disk is one folder, not the disk.** A page needs its own pictures and
 * stylesheet, and the app's `orrery-asset:` would have served them — along with
 * every other path there is, to a document that writes its own addresses. So
 * the frame is given `orrery-page:` instead, which reaches exactly one folder
 * and is described in `core/preview-asset`.
 *
 * **Nothing reaches the network unless it is asked for.** An HTML file from
 * outside is full of URLs pointing back at whoever wrote it, and opening one to
 * read it should not tell them so. Remote references are refused by default and
 * the reader says how many it refused; loading them is a decision, taken per
 * file, by the person reading it.
 *
 * The counts below are for that sentence in the interface and for nothing else.
 * They are read off the source with patterns, they are approximate, and no
 * security decision is taken from them — those all belong to the two paragraphs
 * above.
 */

/**
 * `.xhtml` is in the list and is read as HTML, on purpose.
 *
 * A browser given `application/xhtml+xml` parses it as XML, which is strict:
 * one unclosed tag anywhere and the whole document is replaced by a parser
 * error. That is the correct thing for a page being served and the wrong thing
 * for a reader, whose job is to show you the file you opened. The cost is that
 * a self-closing non-void tag — `<div/>` — swallows what follows it, which XHTML
 * 1.0's own compatibility guidelines tell authors not to write for exactly this
 * reason. Being forgiving is the trade; do not "fix" it into strictness without
 * deciding that a parser error is a better answer than an imperfect page.
 */
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

/** Files the reader can render, rather than only edit. */
export function isHtmlFile(p: string): boolean {
  return HTML_EXTENSIONS.has(extname(p).toLowerCase())
}

/** The scheme the page itself is served from; also where its reader lives. */
const PREVIEW_SCHEME = 'orrery-preview'

export interface PreviewOptions {
  /** Whether the reader has been told to fetch this file's remote references. */
  allowRemote: boolean
  /**
   * Whether the reader has been told to run this file's own scripts.
   *
   * Off unless somebody asked for this file, and never remembered beyond the
   * tab: it is consent about one document, and the next one has not earned it.
   */
  allowScripts: boolean
}

export interface PreviewDocument {
  /** The document to serve. */
  html: string
  /** The `Content-Security-Policy` header it is served under. */
  policy: string
  /** The source has scripts, which will not run — worth saying out loud. */
  hasScripts: boolean
  /** Roughly how many remote references there are, for the offer to load them. */
  remoteCount: number
}

/**
 * References out to the network. Deliberately loose: it is counting, and one
 * missed URL costs a number in a sentence, not a load nobody consented to.
 *
 * Only what would *fetch*. A plain `<a href="https://…">` is a place the
 * document could go, not somewhere it reaches on its own, and counting links
 * would put a number in front of the reader that loading remote content does
 * not change.
 */
const REMOTE_ATTRIBUTE = /\b(?:src|srcset|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\//gi
/**
 * Remote *code*, which the offer never covers and so must not be counted in it.
 *
 * Loading remote content is a decision about pictures. Running remote code is a
 * decision nothing here offers at all, so a `<script src="https://…">` counted
 * among the things a button will fetch would be a number the button cannot act
 * on — press it and one of them stays exactly where it was.
 */
const REMOTE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//gi
const REMOTE_LINK = /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//gi
const REMOTE_CSS_URL = /url\(\s*["']?\s*(?:https?:)?\/\//gi
const SCRIPT_TAG = /<script[\s>]/i

/**
 * What the frame may load.
 *
 * `default-src 'none'` is the whole of it, and every line after is an exception
 * to that — so scripts, frames, workers, websockets and anything added to the
 * web platform after this was written are refused by default rather than by
 * being listed. `orrery-page:` is how a file's own stylesheet and pictures
 * reach it: a view of one folder, scoped to this document, described in
 * `core/preview-asset`. It is deliberately *not* `orrery-asset:`, which is the
 * app's own view of the whole disk and would let a page name any path in it.
 *
 * This is the whole of the policy the frame is under, and it was not always so.
 * A `srcdoc` document inherits the CSP of the page embedding it and the two
 * intersect, so every directive here could only narrow what `renderer/index.html`
 * already allowed. Serving the page over a scheme of its own ended that
 * inheritance — see `main/preview-protocol`. Widening something here is now a
 * decision about one document rather than about the application.
 */
function contentPolicy(options: PreviewOptions): string {
  const { allowRemote, allowScripts } = options
  /**
   * Remote content covers what a page needs to *look* like itself.
   *
   * That is stylesheets and webfonts as much as pictures. It did not use to:
   * the page was inlined into the app's own document and inherited its policy,
   * which allows neither, so naming them here would have meant widening what
   * the application itself may load — too big a promise for a preview. Serving
   * the page from its own scheme ended that. Its policy is its own now, so the
   * offer can cover the whole of what "load this page's remote content" means,
   * and a document that arrives in the wrong typeface because its font was
   * refused is one this can stop happening.
   *
   * Code is still not in it, at any setting. See `script-src` below.
   */
  const remote = allowRemote ? ' https:' : ''
  return [
    "default-src 'none'",
    /**
     * The page's own code, when it has been asked for.
     *
     * `'unsafe-inline'` because a document that draws itself writes its script
     * in the file — there is no nonce to give it and no build step to add one.
     * `orrery-page:` for a script sitting beside it on disk — beside *it*,
     * which the scheme itself enforces rather than taking the page's word for.
     * Never a remote source, whatever else is allowed: fetching a picture
     * from the internet tells somebody you opened their file, and fetching
     * *code* from the internet hands them the inside of the page you are
     * reading. Those are not the same decision and this one is not offered.
     *
     * What keeps this safe is not the list — it is the frame. Scripts run in
     * an opaque origin with no `allow-same-origin`, so the page cannot reach
     * the application around it, its storage, or anything it did not bring.
     */
    /**
     * Exactly one script when the page's own code has not been asked for, and
     * that one is the app's: `core/preview-reader`, which keeps the reader's
     * place across a rebuild. Naming the file rather than the scheme matters —
     * `orrery-preview:` alone would admit any other document in the preview
     * store as a script source.
     */
    allowScripts
      ? `script-src 'unsafe-inline' orrery-page: ${readerScriptUrl(PREVIEW_SCHEME)}`
      : `script-src ${readerScriptUrl(PREVIEW_SCHEME)}`,
    `img-src data: orrery-page:${remote}`,
    `media-src data: orrery-page:${remote}`,
    `style-src 'unsafe-inline' orrery-page:${remote}`,
    `font-src data: orrery-page:${remote}`,
    /**
     * Nothing may repoint what a reference means.
     *
     * This was left out while the reader wrote a `<base>` of its own, which
     * was then the only way a bare `#fragment` resolved to the document rather
     * than to the page embedding it — and a policy tight enough to forbid the
     * page's base would have forbidden that one too. Serving the page from its
     * own URL made the reader's base unnecessary and it was removed, so the
     * directive costs nothing now.
     *
     * `stripPageBase` already takes every base element out of the document.
     * This is the same guarantee for a page that has been allowed to run, and
     * could otherwise write one at runtime.
     */
    "base-uri 'none'",

    "form-action 'none'"
  ]
    .filter((directive) => directive !== '')
    .join('; ')
}

/** Count matches without keeping them; the regexes are global and stateful. */
function countMatches(source: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  let total = 0
  while (pattern.exec(source) !== null) total += 1
  return total
}

/**
 * Prepare an HTML document to be read, with the policy it is read under.
 *
 * Pure: it takes text and gives back text, so what the reader is allowed to do
 * can be tested without a browser, an iframe, or a file on disk.
 */
export function buildPreview(source: string, options: PreviewOptions): PreviewDocument {
  return {
    html: source,
    policy: contentPolicy(options),
    hasScripts: SCRIPT_TAG.test(source),
    remoteCount:
      countMatches(source, REMOTE_ATTRIBUTE) -
      countMatches(source, REMOTE_SCRIPT) +
      countMatches(source, REMOTE_LINK) +
      countMatches(source, REMOTE_CSS_URL)
  }
}
