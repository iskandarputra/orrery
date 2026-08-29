import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Facet, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { CALLOUT_RE } from './features/blockquote'

/** Renders in place of a soft line break so two source lines flow as one. */
class SoftSpaceWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-or-softbreak'
    span.textContent = ' '
    return span
  }
  override ignoreEvent(): boolean {
    return false
  }
}

const softSpace = Decoration.replace({ widget: new SoftSpaceWidget() })

/** A markdown hard break keeps the line break: trailing two spaces or backslash. */
function isHardBreak(lineText: string): boolean {
  return /( {2,}|\\)$/.test(lineText)
}

/**
 * `> [!NOTE] Title` and the body below it are one paragraph to the parser, but
 * the title is a heading rather than the first half of a sentence — joining
 * them would run the two together on one line.
 */
function isCalloutTitle(lineText: string): boolean {
  return CALLOUT_RE.test(lineText)
}

/**
 * `[^label]: the note` at the foot of a document.
 *
 * The parser reads a run of these as one paragraph, so reflow joined them into
 * a single line and the list of notes became a sentence. Each is its own entry,
 * the same way a callout title is its own line.
 */
function isFootnoteDefinition(lineText: string): boolean {
  return /^[ \t]{0,3}\[\^[^\]\s]+\]:/.test(lineText)
}

/** Facet controlling whether paragraph reflow is enabled. */
export const reflowEnabledFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? Boolean(values[values.length - 1]) : false)
})

function build(state: EditorState): DecorationSet {
  const enabled = state.facet(reflowEnabledFacet)
  if (!enabled) return Decoration.none

  const decos: Range<Decoration>[] = []
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Paragraph') return
      const first = state.doc.lineAt(node.from)
      const last = state.doc.lineAt(node.to)
      // Join every internal newline of the paragraph (all lines but the last).
      for (let n = first.number; n < last.number; n++) {
        const line = state.doc.line(n)
        if (isHardBreak(line.text) || isCalloutTitle(line.text)) continue
        // Either side: a definition must not be pulled up into the prose above
        // it, nor have the next definition pulled onto its own line.
        if (isFootnoteDefinition(line.text) || isFootnoteDefinition(state.doc.line(n + 1).text)) {
          continue
        }
        decos.push(softSpace.range(line.to, line.to + 1))
      }
      return false // paragraphs don't nest
    }
  })
  return Decoration.set(decos, true)
}

/**
 * StateField for paragraph reflow: required by CodeMirror 6 for decorations
 * that replace line breaks. Controlled dynamically via reflowEnabledFacet.
 */
export const reflowField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const prev = tr.startState.facet(reflowEnabledFacet)
    const next = tr.state.facet(reflowEnabledFacet)
    if (prev !== next || tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return build(tr.state)
    }
    return value.map(tr.changes)
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f))
  ]
})

/** Returns facet extension to dynamically toggle paragraph reflow */
export function reflowParagraphs(enabled = true): Extension {
  return reflowEnabledFacet.of(enabled)
}

export { build as buildReflowDecorations }
