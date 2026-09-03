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
 * **The policy is a Content-Security-Policy, not a filter.** Notes go through
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
  /**
   * Directory the file lives in, as an asset URL, for relative links to
   * resolve against. Null for a buffer with no path — an untitled document has
   * no directory, and relative links in one cannot resolve anywhere.
   */
  baseHref: string | null
  /** Whether the reader has been told to fetch this file's remote references. */
  allowRemote: boolean
}

export interface PreviewDocument {
  /** The document to hand a sandboxed iframe's `srcdoc`. */
  srcdoc: string
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
function contentPolicy(allowRemote: boolean): string {
  // Remote is images and media only. Widening the app's own policy to fetch
  // remote stylesheets and fonts for a preview is a bigger promise than this
  // feature needs, and the intersection above would refuse them anyway.
  const remote = allowRemote ? ' https:' : ''
  return [
    "default-src 'none'",
    `img-src data: orrery-asset:${remote}`,
    `media-src data: orrery-asset:${remote}`,
    "style-src 'unsafe-inline' orrery-asset:",
    'font-src data: orrery-asset:',
    // A document that sets its own `<base>` cannot point relative links
    // somewhere else. The injected one below wins on order anyway — the first
    // base element in a document is the one that counts — and this is what
    // stops the second one being worth writing.
    'base-uri orrery-asset:',
    "form-action 'none'"
  ].join('; ')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Put the injected head where it governs the rest of the document.
 *
 * A CSP in a `<meta>` applies to what comes after it, so it has to go first —
 * but not before the doctype. Prepending to the source pushes the doctype down
 * the document where it stops being a doctype, and the page silently renders in
 * quirks mode: a different box model, a different line height, a preview that
 * disagrees with every other viewer about what the file looks like.
 */
function injectIntoHead(source: string, injected: string): string {
  const at = (index: number): string => source.slice(0, index) + injected + source.slice(index)

  const head = /<head[^>]*>/i.exec(source)
  if (head) return at(head.index + head[0].length)

  const html = /<html[^>]*>/i.exec(source)
  if (html) return at(html.index + html[0].length)

  // A fragment with a doctype and no `<html>`, or no doctype at all. The parser
  // opens a head of its own around whatever it finds first either way.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source)
  if (doctype) return at(doctype[0].length)

  return injected + source
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
  const base = options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : ''
  const injected =
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(contentPolicy(options.allowRemote))}">` +
    base

  return {
    srcdoc: injectIntoHead(source, injected),
    hasScripts: SCRIPT_TAG.test(source),
    remoteCount:
      countMatches(source, REMOTE_ATTRIBUTE) +
      countMatches(source, REMOTE_LINK) +
      countMatches(source, REMOTE_CSS_URL)
  }
}
