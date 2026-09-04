import { resolveAssetUrl } from '@core/asset'
import { declaresSingleDollar, findMath } from '@core/html-math'
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
 * This pass is also where a page's addresses are settled: every reference that
 * loads something is rewritten to an absolute one, and the document is given a
 * base of its own so that `href="#section"` still means this page. See
 * `resolveUrls` and `anchorFragments` for why each is necessary and why neither
 * is enough alone.
 */

/** Attributes that fetch, per element. `href` only where it is not a link. */
const URL_ATTRIBUTES: Record<string, string[]> = {
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  link: ['href'],
  object: ['data'],
  input: ['src']
}

export interface PreparedPage {
  /** The document, ready for `srcdoc`. */
  html: string
  /** Diagrams drawn out of their source, for the reader to say so. */
  diagrams: number
  /** Equations typeset from their TeX. */
  equations: number
}

/** Absolute enough to leave alone, or not a location at all. */
function isAbsolute(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url.trim())
}

/**
 * Point every relative reference at the folder the file lives in.
 *
 * Only the attributes that load something. An `<a href>` is deliberately left
 * as it was: rewriting it would turn a link into an address the frame is not
 * allowed to navigate to anyway, and a bare `#fragment` must stay a fragment.
 */
function resolveUrls(doc: Document, docPath: string | null): void {
  for (const [tag, attributes] of Object.entries(URL_ATTRIBUTES)) {
    for (const el of doc.querySelectorAll(tag)) {
      for (const attribute of attributes) {
        const value = el.getAttribute(attribute)
        if (!value || isAbsolute(value)) continue
        const resolved = resolveAssetUrl(docPath, value)
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
          if (!url || isAbsolute(url)) return candidate.trim()
          const resolved = resolveAssetUrl(docPath, url)
          return [resolved ?? url, ...rest].join(' ')
        })
        .join(', ')
      el.setAttribute('srcset', rebuilt)
    }
  }
}

/**
 * Make `href="#section"` scroll the page instead of trying to leave it.
 *
 * A `srcdoc` document reports its own URL as `about:srcdoc` but resolves
 * relative URLs against the URL of the page *embedding* it. So a bare fragment
 * became an address for the app's own `index.html`, which is a different
 * document, which is a navigation — and the policy refuses those, so every
 * in-page link in every table of contents did nothing at all.
 *
 * Naming `about:srcdoc` as the base is what makes a fragment resolve to this
 * document again, and a same-document fragment is what the browser answers by
 * scrolling. Nothing else needs the base: every reference that loads has
 * already been rewritten to an absolute one above.
 *
 * The page's own `<base>`, if it has one, is dropped rather than left to fight
 * this one — the first base in a document wins, and letting a page choose where
 * its relative URLs point is the thing `base-uri` was guarding against. That
 * guard now lives here, where the whole document is parsed and rebuilt, rather
 * than in a policy the page could satisfy in some other way.
 */
function anchorFragments(doc: Document): void {
  for (const existing of doc.querySelectorAll('base')) existing.remove()
  const base = doc.createElement('base')
  base.setAttribute('href', 'about:srcdoc')
  doc.head.prepend(base)
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
    if (parent.closest('code, pre, script, style, math')) continue
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
export async function preparePage(source: string, docPath: string | null): Promise<PreparedPage> {
  const doc = new DOMParser().parseFromString(source, 'text/html')

  resolveUrls(doc, docPath)
  anchorFragments(doc)
  const [diagrams, equations] = [await drawDiagrams(doc), await typesetMath(doc, source)]
  if (diagrams > 0) addDiagramFallback(doc)

  // The doctype does not survive serialising the element tree, and a document
  // that loses it renders in quirks mode: a different box model, a different
  // line height, a page that disagrees with every other viewer about itself.
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : ''
  return { html: doctype + doc.documentElement.outerHTML, diagrams, equations }
}
