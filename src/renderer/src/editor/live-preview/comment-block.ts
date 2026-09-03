import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * Hiding HTML comments in Reading mode.
 *
 * A StateField rather than part of the live-preview plugin, and that is the
 * whole reason this file exists: a comment can run over several lines, hiding
 * it means replacing its line breaks, and CodeMirror refuses to take such a
 * decoration from a ViewPlugin — it throws `RangeError: Decorations that
 * replace line breaks may not be specified via plugins` when the view mounts.
 * The pane crashed on any note holding a multi-line comment.
 *
 * The editing half of the feature stays in `features/html-comment.ts`, where a
 * comment is merely muted: hiding text somebody is editing would make a trap
 * out of the document.
 */

/** No widget: a comment is not content, so nothing stands in for it. */
const hidden = Decoration.replace({})
const hiddenBlock = Decoration.replace({ block: true })

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = state.doc

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Comment' && node.name !== 'CommentBlock') return
      const startLine = doc.lineAt(node.from)
      const endLine = doc.lineAt(Math.min(node.to, doc.length))

      // A comment sitting on its own lines takes the lines with it, so the
      // rendered document does not keep a gap where it used to be. One sharing
      // a line with prose can only take itself.
      const alone =
        doc.sliceString(startLine.from, node.from).trim() === '' &&
        doc.sliceString(node.to, endLine.to).trim() === ''

      decos.push(
        alone ? hiddenBlock.range(startLine.from, endLine.to) : hidden.range(node.from, node.to)
      )
      return false
    }
  })
  return Decoration.set(decos, true)
}

/**
 * Only in Reading mode, which is what `reveal === false` means.
 *
 * Returns nothing at all while editing, so the field is not even registered
 * there and the muting feature has the comment to itself.
 */
export function commentHiding(reveal = true): Extension {
  if (reveal) return []
  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state))
        return build(tr.state)
      return value.map(tr.changes)
    },
    provide: (f) => [
      EditorView.decorations.from(f),
      // So a cursor cannot be put inside something that is not on screen.
      EditorView.atomicRanges.of((view) => view.state.field(f))
    ]
  })
}

export { build as buildCommentHiding }
