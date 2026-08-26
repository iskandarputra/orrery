import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const commentLine = Decoration.line({ class: 'cm-zy-comment-line' })

/**
 * HTML comments (`<!-- ... -->`) — internal notes, author metadata, TODOs.
 *
 * Reading mode is a rendered document, so a comment is hidden there exactly as
 * every other renderer hides it: it is not content. While editing, hiding it
 * would make text you cannot see, so it stays visible and muted instead.
 */
export const htmlComment: Feature = {
  nodes: ['Comment', 'CommentBlock'],
  enter(node, ctx) {
    if (ctx.reading) {
      ctx.conceal(node.from, node.to)
      return
    }
    if (ctx.lineRevealed(node.from, node.to)) return
    const doc = ctx.state.doc
    const last = doc.lineAt(node.to).number
    for (let n = doc.lineAt(node.from).number; n <= last; n++) {
      ctx.add(commentLine.range(doc.line(n).from))
    }
  }
}
