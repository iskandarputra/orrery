import { extname } from './paths'

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
 * **The document is never trusted.** It is shown in an iframe with an empty
 * `sandbox`, which puts it in an opaque origin with no scripting, no forms, no
 * navigation of the window around it and no downloads. That alone is the
 * boundary. Everything below is a second one, so that a mistake in either is
 * not a mistake in both.
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

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

/** Files the reader can render, rather than only edit. */
export function isHtmlFile(p: string): boolean {
  return HTML_EXTENSIONS.has(extname(p).toLowerCase())
}

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
 * being listed. `orrery-asset:` is the app's own read-only view of the disk,
 * which is how a file's own stylesheet and pictures reach it.
 *
 * This is not the only policy the frame is under. A `srcdoc` document inherits
 * the CSP of the page embedding it, and the two intersect, so a directive here
 * can only narrow what the app's own policy already allows.
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
     * `orrery-asset:` for a script sitting beside it on disk. Never a remote
     * source, whatever else is allowed: fetching a picture from the internet
     * tells somebody you opened their file, and fetching *code* from the
     * internet hands them the inside of the page you are reading. Those are
     * not the same decision and this one is not offered.
     *
     * What keeps this safe is not the list — it is the frame. Scripts run in
     * an opaque origin with no `allow-same-origin`, so the page cannot reach
     * the application around it, its storage, or anything it did not bring.
     */
    allowScripts ? "script-src 'unsafe-inline' orrery-asset:" : '',
    `img-src data: orrery-asset:${remote}`,
    `media-src data: orrery-asset:${remote}`,
    `style-src 'unsafe-inline' orrery-asset:${remote}`,
    `font-src data: orrery-asset:${remote}`,
    // No `base-uri`, deliberately. The reader needs a `<base>` of its own — it
    // is the only way a bare `#fragment` resolves to this document rather than
    // to the page embedding it — and a policy tight enough to forbid the
    // page's would forbid that one too. The guarantee moved instead to the
    // rewrite that builds this document: it parses the whole thing, removes
    // every base element the page brought, and adds exactly one.

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
