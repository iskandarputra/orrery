import { declaresSingleDollar, findMath } from '@core/html-math'
import { pageReferenceUrl } from '@core/preview-asset'
import { renderMermaidToString } from './live-preview/mermaid'

/**
 * An HTML page, prepared for a reader that runs none of its code.
 *
 * The frame the page ends up in has no scripting at all, which is what makes it
 * safe to show a file from anywhere. It is also what makes a page that draws
 * itself with JavaScript arrive as the raw text it was written as: a mermaid
 * diagram is its own source, an equation is its own TeX. That is not a preview
 * of the document, it is a preview of the document's plumbing.
 *
 * So the two that a knowledge base actually meets get drawn out here, in the
 * app, where mermaid and KaTeX already live for exactly this purpose in notes —
 * and what goes into the frame is the finished picture. Nothing from the page
 * runs to produce it; the app reads the source and draws it, the same way it
 * draws a fenced diagram in markdown.
 *
 * This pass is also where a page's addresses are settled. Every reference that
 * loads something is rewritten to an absolute one — in the markup and in the
 * page's own CSS alike — and any base the page brought is removed, so nothing
 * left in the document can move them again. See `resolveUrls`,
 * `resolveStyleUrls` and `stripPageBase`.
 */

/**
 * Attributes that fetch, per element. `href` only where it is not a link.
 *
 * `use` and `image` are SVG, where `href` fetches rather than navigates and
 * the older `xlink:href` spelling is still what most drawing tools emit. An
 * icon sprite referenced as `<use href="icons.svg#save">` is the ordinary way
 * a page carries its icons, and left unresolved every one of them is blank.
 */
const URL_ATTRIBUTES: Record<string, string[]> = {
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  link: ['href'],
  object: ['data'],
  input: ['src'],
  use: ['href', 'xlink:href'],
  image: ['href', 'xlink:href']
}

/**
 * What a reference in this document is allowed to resolve to.
 *
 * The preview id is in every address the page is given, so main can tell which
 * page is asking; `root` is the folder that page may read from, and is the
 * boundary itself. Both are settled once, outside, and carried in rather than
 * worked out per reference — there is one answer per document and it should not
 * be recomputed by anything that could get it wrong differently.
 */
export interface PageContext {
  previewId: string
  docPath: string | null
  root: string | null
}

export interface PreparedPage {
  /** The document, ready to be served to the frame. */
  html: string
  /** Diagrams drawn out of their source, for the reader to say so. */
  diagrams: number
  /** Equations typeset from their TeX. */
  equations: number
}

/** Already carries a scheme, so it says where it goes without help. */
function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url.trim())
}

/**
 * The address a reference should be given, or null to leave it as it was.
 *
 * A fragment is a place in this document and must stay one. An address that
 * already names its scheme is left alone — it is either remote, in which case
 * the policy decides whether it loads, or already resolved.
 *
 * The exception is the protocol-relative form. `//host/pic.png` is how a page
 * written for the web writes a remote address, and it is counted among the
 * remote references the reader offers to load — but with no scheme of its own
 * it resolves against `orrery-preview:` and fetches nothing at all. Pressing
 * the button would leave it exactly where it was, which is the mismatch
 * `html-document` takes care to avoid for remote code. Giving it `https:` is
 * what makes the offer deliver the number it names.
 */
function referenceUrl(page: PageContext, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (hasScheme(trimmed)) return null

  // A query and a fragment are not part of the path and must not be encoded
  // as though they were. The address is built segment by segment, so
  // `icons.svg#save` handed over whole comes back pointing at a file named
  // `icons.svg%23save` — which is how an entire sprite sheet of icons resolves
  // to nothing. `<use href="icons.svg#save">` is the ordinary way a page
  // carries them, so this is the common case, not the odd one.
  const cut = trimmed.search(/[?#]/)
  const path = cut === -1 ? trimmed : trimmed.slice(0, cut)
  const suffix = cut === -1 ? '' : trimmed.slice(cut)
  if (!path) return null

  // Null when the reference points outside the folder this page may read, and
  // the reference is then left exactly as the page wrote it — which resolves
  // against `orrery-preview:` and fetches nothing. See `core/preview-asset`.
  const resolved = pageReferenceUrl(page.previewId, page.docPath, page.root, path)
  return resolved === null ? null : resolved + suffix
}

/**
 * Point every relative reference at the folder the file lives in.
 *
 * Only the attributes that load something. An `<a href>` is deliberately left
 * as it was: rewriting it would turn a link into an address the frame is not
 * allowed to navigate to anyway, and a bare `#fragment` must stay a fragment.
 */
function resolveUrls(doc: Document, page: PageContext): void {
  for (const [tag, attributes] of Object.entries(URL_ATTRIBUTES)) {
    for (const el of doc.querySelectorAll(tag)) {
      for (const attribute of attributes) {
        const value = el.getAttribute(attribute)
        if (!value) continue
        const resolved = referenceUrl(page, value)
        if (resolved) el.setAttribute(attribute, resolved)
      }
    }
    // `srcset` is a list of candidates with descriptors, so it is rebuilt
    // rather than replaced: "a.png 1x, b.png 2x".
    for (const el of doc.querySelectorAll(`${tag}[srcset]`)) {
      const rebuilt = (el.getAttribute('srcset') ?? '')
        .split(',')
        .map((candidate) => {
          const [url, ...rest] = candidate.trim().split(/\s+/)
          if (!url) return candidate.trim()
          const resolved = referenceUrl(page, url)
          return [resolved ?? url, ...rest].join(' ')
        })
        .join(', ')
      el.setAttribute('srcset', rebuilt)
    }
  }
}

/** `url(…)` in a stylesheet, quoted or bare. */
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g
/** `@import "…"` — the one form that names a file without saying `url`. */
const CSS_IMPORT = /(@import\s+)(["'])([^"']+)\2/g

/**
 * The same rewrite, for the addresses that live in CSS rather than in markup.
 *
 * A page carries at least as many pictures in its stylesheet as in its
 * elements — a background, a bullet, a masthead — and until this ran they
 * were the references the reader quietly dropped. There is no `<base>` to
 * catch them: a relative `url(bg.png)` resolves against `orrery-preview:` and
 * comes back as nothing, so a page arrived stripped of its own furniture with
 * no sign that anything was missing.
 *
 * Only the CSS the document itself carries. A stylesheet loaded from beside
 * the file needs none of this — its own URLs resolve against its own
 * `orrery-page:` address, which is already the right folder.
 *
 * Rewritten values are always quoted. An encoded path keeps its brackets, and
 * a bare `url(…)` containing one ends the function early.
 */
function rewriteCss(css: string, page: PageContext): string {
  return css
    .replace(CSS_URL, (whole, _quote: string, value: string) => {
      const resolved = referenceUrl(page, value)
      return resolved ? `url("${resolved}")` : whole
    })
    .replace(CSS_IMPORT, (whole, at: string, _quote: string, value: string) => {
      const resolved = referenceUrl(page, value)
      return resolved ? `${at}"${resolved}"` : whole
    })
}

/** Both places a document keeps its own CSS: a `<style>` block and a `style=`. */
function resolveStyleUrls(doc: Document, page: PageContext): void {
  for (const style of doc.querySelectorAll('style')) {
    const css = style.textContent ?? ''
    if (css) style.textContent = rewriteCss(css, page)
  }
  for (const el of doc.querySelectorAll<HTMLElement>('[style]')) {
    const css = el.getAttribute('style') ?? ''
    if (css) el.setAttribute('style', rewriteCss(css, page))
  }
}
/**
 * A page cannot repoint its own relative references.
 *
 * Everything that loads has already been rewritten to an absolute address, so
 * a `<base>` left in the document could only move something away from where
 * the reader resolved it to.
 *
 * Nothing needs one in its place. The page is served from a URL of its own,
 * which is what makes `href="#section"` a fragment *of this document* and
 * therefore a scroll. It was not always so: as a `srcdoc` the document
 * reported its URL as `about:srcdoc` but resolved relative URLs against the
 * page embedding it, so every in-page link was an address for the app's own
 * window — a different document, so a navigation, which the policy refuses.
 * Every table of contents did nothing at all.
 */
function stripPageBase(doc: Document): void {
  for (const base of doc.querySelectorAll('base')) base.remove()
}

/** Put the diagram fallback first, where the page can still overrule it. */
function addDiagramFallback(doc: Document): void {
  const style = doc.createElement('style')
  style.textContent = DIAGRAM_FALLBACK_CSS
  doc.head.prepend(style)
}

/** The markup every mermaid page uses, whichever way it loads the library. */
function mermaidBlocks(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('.mermaid, pre[class*="mermaid"]')]
}

async function drawDiagrams(doc: Document): Promise<number> {
  const blocks = mermaidBlocks(doc)
  if (blocks.length === 0) return 0

  // The page is somebody else's document on a white ground, not the app's
  // surface, so the diagram is drawn for that rather than for the app's theme.
  const drawn = await Promise.all(
    blocks.map((block) => renderMermaidToString(block.textContent ?? '', 'default'))
  )

  let count = 0
  blocks.forEach((block, i) => {
    const result = drawn[i]!
    if ('svg' in result) {
      // Filled in place and stamped, which is exactly what mermaid itself does
      // to an element it has drawn. Both halves matter, and a page proved it:
      // a document styling `pre.mermaid svg{max-width:100%}` and
      // `pre.mermaid[data-processed="true"]{white-space:normal}` gets neither
      // if the `<pre>` is swapped for a `<div>` — every diagram then renders at
      // its natural width and pushes a horizontal scrollbar across the whole
      // document. Following the library's own contract is what makes a page
      // written for mermaid look the way it was written to look.
      block.innerHTML = result.svg
      block.setAttribute('data-processed', 'true')
      // Marked as ours, so the reader can offer to open it full screen. A
      // diagram in a note has that; one in an HTML page had nothing, because
      // the app cannot reach inside the frame to add a control. The reader
      // script can, and this is how it knows which figures are the app's own
      // work rather than something the page drew for itself.
      block.setAttribute('data-orrery-figure', 'diagram')
      count++
    } else {
      block.textContent = `Diagram could not be drawn: ${result.error}`
    }
  })
  return count
}

/**
 * What a diagram does when the page has no opinion about it.
 *
 * A page written for mermaid styles its own diagrams and this defers to it —
 * the rule goes at the very top of the head, so anything the page says later
 * wins on equal specificity. A page that merely *contains* mermaid, with no
 * styling for it, still gets a diagram that fits the width it is read in
 * rather than one that runs off the side.
 */
const DIAGRAM_FALLBACK_CSS = '.mermaid svg{max-width:100%;height:auto}'

/** Elements whose text is not prose and must never be scanned for maths. */
const NOT_PROSE = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'MATH', 'SVG'])

/**
 * Whether this page wanted its TeX typeset.
 *
 * Only pages that asked. Scanning every document for `\(` would find it in
 * prose about LaTeX, in a regular expression, in a Windows path — and would
 * replace it with an equation nobody wrote.
 */
function declaresMath(doc: Document): boolean {
  for (const script of doc.querySelectorAll('script')) {
    const src = script.getAttribute('src') ?? ''
    // The library's own name, and the component bundles it actually ships as:
    // MathJax is normally loaded as `tex-mml-chtml.js` or one of its siblings,
    // from a URL that need not spell "mathjax" anywhere.
    if (/mathjax|katex|asciimath|tex-(?:mml|chtml|svg)|mml-chtml/i.test(src)) return true
    if (/MathJax|katex\.render/i.test(script.textContent ?? '')) return true
    const type = script.getAttribute('type') ?? ''
    if (/^math\/tex/i.test(type)) return true
  }
  return !!doc.querySelector('.math, .katex, [data-katex], mjx-container')
}

async function typesetMath(doc: Document, source: string): Promise<number> {
  if (!declaresMath(doc)) return 0

  const { default: katex } = await import('katex')
  const single = declaresSingleDollar(source)
  let count = 0

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = (node as Text).parentElement
    if (!parent || NOT_PROSE.has(parent.tagName.toUpperCase())) continue
    // `svg` is in the list for the diagrams drawn a few lines above this. The
    // text inside one is a label mermaid wrote, and its parent is a `<text>`
    // or a `<tspan>`, which `NOT_PROSE` never sees. A `<pre class="mermaid">`
    // was protected by accident through `pre`; a `<div class="mermaid">` was
    // not, so a diagram whose label mentioned a dollar or a backslash had an
    // equation put inside its SVG — where MathML draws nothing at all and the
    // label goes blank.
    if (parent.closest('code, pre, script, style, math, svg')) continue
    texts.push(node as Text)
  }

  for (const text of texts) {
    const content = text.data
    const spans = findMath(content, single)
    if (spans.length === 0) continue

    // Rebuilt as a fragment so the prose around each equation is preserved
    // exactly, including the spaces that decide where a line breaks.
    const fragment = doc.createDocumentFragment()
    let at = 0
    for (const span of spans) {
      if (span.start > at) {
        fragment.appendChild(doc.createTextNode(content.slice(at, span.start)))
      }
      const holder = doc.createElement(span.display ? 'div' : 'span')
      try {
        // MathML, not KaTeX's usual HTML: that needs a stylesheet and four
        // webfonts the frame has no way to reach, and MathML is drawn by the
        // browser itself out of nothing but the markup.
        holder.innerHTML = katex.renderToString(span.expr, {
          displayMode: span.display,
          output: 'mathml',
          throwOnError: false
        })
        count++
      } catch {
        holder.textContent = content.slice(span.start, span.end)
      }
      fragment.appendChild(holder)
      at = span.end
    }
    if (at < content.length) fragment.appendChild(doc.createTextNode(content.slice(at)))
    text.replaceWith(fragment)
  }

  return count
}

/**
 * Read a page and give back the one the frame should show.
 *
 * Parsed with `DOMParser` into an inert document — nothing runs and nothing
 * loads while it is being rewritten — and serialised back out afterwards.
 */
export async function preparePage(source: string, page: PageContext): Promise<PreparedPage> {
  const doc = new DOMParser().parseFromString(source, 'text/html')

  resolveUrls(doc, page)
  resolveStyleUrls(doc, page)
  stripPageBase(doc)
  const [diagrams, equations] = [await drawDiagrams(doc), await typesetMath(doc, source)]
  if (diagrams > 0) addDiagramFallback(doc)

  // The doctype does not survive serialising the element tree, and a document
  // that loses it renders in quirks mode: a different box model, a different
  // line height, a page that disagrees with every other viewer about itself.
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : ''
  return { html: doctype + doc.documentElement.outerHTML, diagrams, equations }
}
