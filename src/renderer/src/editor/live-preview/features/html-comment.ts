import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const commentLine = Decoration.line({ class: 'cm-zy-comment-line' })

/**
 * HTML Comments (`<!-- ... -->`) — used for internal notes, author metadata,
 * and documentation notes.
 *
 * In Reading mode (reveal=false): concealed cleanly as per HTML/Markdown specification.
 * In Hybrid mode: styled with muted theme comment styling (`--zy-code-comment`).
 */
export const htmlComment: Feature = {
  nodes: ['Comment', 'CommentBlock'],
  enter(node, ctx) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)

    // In Reading mode (pure preview), conceal HTML comments as standard markdown behavior
    if (!ctx.revealed(node.from, node.to)) {
      // In reading mode (reveal=false for the entire view), conceal the comment range
      if (!ctx.lineRevealed(node.from, node.to)) {
        for (let n = first.number; n <= last.number; n++) {
          ctx.add(commentLine.range(doc.line(n).from))
        }
      }
    }
  }
}
