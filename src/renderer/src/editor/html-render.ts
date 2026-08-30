import { allowedAttributes, isAllowedTag, isSafeUrl } from '@core/html-policy'

/**
 * Turn the HTML in a note into DOM, keeping only what `core/html-policy` allows.
 *
 * Parsed with `DOMParser` rather than by pattern, because deciding what a tag
 * is with a regular expression is how sanitisers get bypassed: the browser's
 * own parser is the only thing that agrees with the browser about where a tag
 * starts. It parses into an inert document, so nothing runs and nothing loads
 * while the tree is being inspected.
 *
 * A tag that is not allowed is unwrapped rather than deleted — its children
 * come through, so `<span class="x">text</span>` renders as `text` instead of
 * as a hole. A tag that could carry behaviour is dropped whole, contents
 * included, because the contents of a `<script>` are the danger.
 */

/** Dropped with everything inside them; their content is not text to show. */
const DROP_ENTIRELY = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript'
])

export interface RenderedHtml {
  fragment: DocumentFragment
  /** Tags that were unwrapped or dropped, for a note that says what it did. */
  removed: string[]
}

export function renderSafeHtml(html: string): RenderedHtml {
  const removed = new Set<string>()
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const fragment = document.createDocumentFragment()

  const convert = (source: Node, into: Node): void => {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(child.textContent ?? ''))
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue

      const element = child as Element
      const tag = element.tagName.toLowerCase()

      if (DROP_ENTIRELY.has(tag)) {
        removed.add(tag)
        continue
      }
      if (!isAllowedTag(tag)) {
        // Unwrapped: the text inside was written to be read.
        removed.add(tag)
        convert(element, into)
        continue
      }

      const clean = document.createElement(tag)
      for (const name of allowedAttributes(tag)) {
        const value = element.getAttribute(name)
        if (value === null) continue
        const isUrl = name === 'href' || name === 'src' || name === 'srcset' || name === 'cite'
        if (isUrl && !isSafeUrl(value, tag === 'img' || tag === 'source')) continue
        clean.setAttribute(name, value)
      }
      // Links out of a note open outside it, and never with a handle back.
      if (tag === 'a' && clean.hasAttribute('href')) {
        clean.setAttribute('target', '_blank')
        clean.setAttribute('rel', 'noreferrer noopener')
      }

      convert(element, clean)
      into.appendChild(clean)
    }
  }

  convert(doc.body, fragment)
  return { fragment, removed: [...removed].sort() }
}
