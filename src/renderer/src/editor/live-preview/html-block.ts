import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { renderSafeHtml } from '../html-render'

/**
 * A block of raw HTML in a note, rendered.
 *
 * Markdown cannot centre a heading, put four badges in a row, or fold a section
 * away, so every README opens with a block of HTML doing exactly that. Left as
 * source it is the first thing anyone sees in reading mode, and it is the one
 * part of the document that is not readable.
 *
 * Rendered through `html-render.ts`, which keeps only what `core/html-policy`
 * allows: a vault holds files from repositories and from other people, and a
 * note is not a place to run code.
 *
 * The block returns to source when the cursor is inside it, the way every other
 * replaced block here does, so it stays editable in Hybrid; in Reading mode it
 * is always rendered.
 */

class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly html: string,
    private readonly from: number
  ) {
    super()
  }

  override eq(other: HtmlBlockWidget): boolean {
    return other.html === this.html && other.from === this.from
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-or-html-block'
    const { fragment, removed } = renderSafeHtml(this.html)
    wrap.appendChild(fragment)

    // Said out loud rather than silently: a note whose `<iframe>` vanished
    // should say so, or the author will think the file is corrupt.
    if (removed.length > 0) {
      const note = document.createElement('p')
      note.className = 'cm-or-html-block__note'
      note.textContent = `Not rendered: ${removed.map((tag) => `<${tag}>`).join(' ')}`
      wrap.appendChild(note)
    }
    return wrap
  }

  /** Static content: it is read and clicked through, never typed into. */
  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

function build(state: EditorState, reveal: boolean): DecorationSet {
  const decos: Range<Decoration>[] = []
  const revealed = (from: number, to: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'HTMLBlock') return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(Math.min(node.to, state.doc.length)).to
      if (revealed(from, to)) return false

      const html = state.doc.sliceString(node.from, node.to)
      // An HTML comment is a block too, and is hidden rather than rendered:
      // `comment-block.ts` in Reading mode, `features/html-comment.ts` while
      // editing.
      if (/^\s*<!--/.test(html)) return false

      decos.push(
        Decoration.replace({ widget: new HtmlBlockWidget(html, from), block: true }).range(from, to)
      )
      return false
    }
  })
  return Decoration.set(decos, true)
}

export function htmlBlockRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      if (
        tr.docChanged ||
        (reveal && tr.selection) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      ) {
        return build(tr.state, reveal)
      }
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
