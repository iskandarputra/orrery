import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, type EditorView, WidgetType } from '@codemirror/view'
import { revealField, type Revealable } from './reveal-field'
import { resolveAssetUrl } from '@core/asset'
import { docPathFacet } from '../doc-context'
import { expandButton } from './expand-button'
import { revealSource } from './reveal-source'

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.url === this.url && other.alt === this.alt && other.interactive === this.interactive
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-or-image'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.loading = 'lazy'
    img.addEventListener('error', () => {
      wrap.classList.add('cm-or-image--broken')
      wrap.textContent = `🖼 ${this.alt || this.url}`
    })
    wrap.appendChild(img)
    wrap.appendChild(expandButton({ kind: 'image', src: this.url, alt: this.alt }))
    if (this.interactive) {
      wrap.addEventListener('mousedown', (event) => {
        // Click reveals the source for editing (not in reading mode).
        event.preventDefault()
        revealSource(view, wrap)
      })
    }
    return wrap
  }

  override ignoreEvent(event: Event): boolean {
    return !this.interactive || event.type !== 'mousedown'
  }
}

function scan(state: EditorState, reveal: boolean): Revealable[] {
  const docPath = state.facet(docPathFacet)
  const items: Revealable[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image') return
      const from = node.from
      const to = node.to
      const urlNode = node.node.getChild('URL')
      if (!urlNode) return
      const rawSrc = state.doc.sliceString(urlNode.from, urlNode.to)
      const url = resolveAssetUrl(docPath, rawSrc)
      if (!url) return
      // Alt text sits between "![" and "]".
      const marks = node.node.getChildren('LinkMark')
      const alt = marks[0] && marks[1] ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
      const deco = Decoration.replace({ widget: new ImageWidget(url, alt, reveal) })
      items.push({ from, to, shown: [deco.range(from, to)] })
    }
  })
  return items
}

/** Render ![alt](src) as inline images; source returns when the cursor enters. */
export function imageRendering(reveal = true): Extension {
  return revealField((state) => scan(state, reveal), reveal, { followParse: true })
}
