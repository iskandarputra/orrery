import { syntaxTree } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { markdownHighlight } from '../theme'
import { expandButton } from './expand-button'
import type { CodeSpan } from '@/state/ui'

/**
 * Colour a range of the document by reading the syntax tree that is already
 * there — the outer markdown parse embeds the nested language, so there is no
 * second parser to load, and the classes are the editor's own highlighter's.
 *
 * Done here rather than in the widget so the result is part of what the widget
 * compares on: the nested parse lands *after* the first render, and a widget
 * that only compared its text would never redraw to pick the colours up.
 */
function spansFor(state: EditorState, from: number, to: number): CodeSpan[] {
  const out: CodeSpan[] = []
  let pos = from
  const push = (end: number, cls: string): void => {
    if (end <= pos) return
    out.push({ text: state.doc.sliceString(pos, end), cls })
    pos = end
  }
  highlightTree(
    syntaxTree(state),
    markdownHighlight,
    (spanFrom, spanTo, classes) => {
      push(spanFrom, '')
      push(spanTo, classes)
    },
    from,
    to
  )
  push(to, '')
  return out
}

/**
 * A fenced code block, rendered as one card.
 *
 * Reading mode only. In the editor a fence is a run of styled `.cm-line`
 * elements, which is right for editing but leaves the block with nothing to
 * scroll: CodeMirror gives every line its own element, sibling elements cannot
 * share a scrollbar, and code is deliberately never wrapped. A long line
 * therefore spills out of its card and drags the whole document sideways,
 * prose and headings with it.
 *
 * Replacing the fence with a single element gives it one scroll container of
 * its own — the same move `table.ts` already makes for the same reason.
 */
class CodeCardWidget extends WidgetType {
  constructor(
    readonly spans: CodeSpan[],
    readonly lang: string
  ) {
    super()
  }

  override eq(other: CodeCardWidget): boolean {
    return (
      other.lang === this.lang &&
      other.spans.length === this.spans.length &&
      other.spans.every((s, i) => s.text === this.spans[i]!.text && s.cls === this.spans[i]!.cls)
    )
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-or-code-card'

    if (this.lang) {
      const badge = document.createElement('span')
      badge.className = 'cm-or-code-card__lang'
      badge.textContent = this.lang
      wrap.appendChild(badge)
    }

    const pre = document.createElement('pre')
    pre.className = 'cm-or-code-card__pre'
    const code = document.createElement('code')
    for (const span of this.spans) {
      if (span.cls) {
        const el = document.createElement('span')
        el.className = span.cls
        el.textContent = span.text
        code.appendChild(el)
      } else {
        code.appendChild(document.createTextNode(span.text))
      }
    }
    pre.appendChild(code)
    wrap.appendChild(pre)
    // Scrolling inside the card handles a long line; a block that is long *and*
    // wide is still easier read on the whole window, the same as a diagram.
    wrap.appendChild(
      expandButton({
        kind: 'code',
        code: this.spans.map((s) => s.text).join(''),
        lang: this.lang,
        spans: this.spans
      })
    )
    return wrap
  }

  /** Static content: the card is read and copied, never typed into. */
  override ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      const lang = info ? state.doc.sliceString(info.from, info.to).trim() : ''
      // A mermaid fence is a diagram, and has a widget of its own; two block
      // replacements over one range would fight.
      if (lang === 'mermaid') return false

      const from = node.from
      const to = Math.min(node.to, state.doc.lineAt(node.to).to)
      const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
      if (!wholeLines) return false

      const body = node.node.getChild('CodeText')
      const spans = body ? spansFor(state, body.from, body.to) : []
      decos.push(
        Decoration.replace({ widget: new CodeCardWidget(spans, lang), block: true }).range(from, to)
      )
      return false
    }
  })
  return Decoration.set(decos, true)
}

/**
 * Render ``` fences as self-contained, horizontally scrollable cards.
 *
 * Reading mode only — `reveal` means the editor flips a block back to source
 * around the cursor, which a replaced block cannot do.
 */
export function codeCardRendering(reveal = true): Extension {
  if (reveal) return []
  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update(value, tr) {
      // Rebuilt as background parsing completes, like the other block widgets:
      // the nested language parse arrives after the first render, and the
      // colours come from it.
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state))
        return build(tr.state)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
