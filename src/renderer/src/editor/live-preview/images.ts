import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
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

function build(state: EditorState, reveal: boolean): DecorationSet {
  const docPath = state.facet(docPathFacet)
  const decos: Range<Decoration>[] = []
  const touches = (a: number, b: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= b && r.to >= a)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image') return
      const from = node.from
      const to = node.to
      if (touches(from, to)) return
      const urlNode = node.node.getChild('URL')
      if (!urlNode) return
      const rawSrc = state.doc.sliceString(urlNode.from, urlNode.to)
      const url = resolveAssetUrl(docPath, rawSrc)
      if (!url) return
      // Alt text sits between "![" and "]".
      const marks = node.node.getChildren('LinkMark')
      const alt = marks[0] && marks[1] ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
      decos.push(Decoration.replace({ widget: new ImageWidget(url, alt, reveal) }).range(from, to))
    }
  })
  return Decoration.set(decos, true)
}

/** Render ![alt](src) as inline images; source returns when the cursor enters. */
export function imageRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      // Also rebuild as background parsing completes (Image node may be absent
      // on a freshly opened, not-yet-fully-parsed document).
      if (
        tr.docChanged ||
        (reveal && tr.selection) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      )
        return build(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
