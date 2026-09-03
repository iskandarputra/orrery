import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const commentLine = Decoration.line({ class: 'cm-or-comment-line' })

/**
 * HTML comments (`<!-- ... -->`) — internal notes, author metadata, TODOs.
 *
 * Reading mode is a rendered document, so a comment is hidden there exactly as
 * every other renderer hides it: it is not content — see `comment-block.ts`,
 * which does that half. While editing, hiding it would make text you cannot
 * see, so it stays visible and muted instead, which is all this does.
 */
export const htmlComment: Feature = {
  nodes: ['Comment', 'CommentBlock'],
  enter(node, ctx) {
    // Reading mode hides comments outright, and does it from a StateField in
    // `comment-block.ts`: a comment spans line breaks, and a ViewPlugin — which
    // is what builds these decorations — may not replace one. Concealing it
    // here threw `RangeError` as soon as the view mounted.
    if (ctx.reading) return
    if (ctx.lineRevealed(node.from, node.to)) return
    const doc = ctx.state.doc
    const last = doc.lineAt(node.to).number
    for (let n = doc.lineAt(node.from).number; n <= last; n++) {
      ctx.add(commentLine.range(doc.line(n).from))
    }
  }
}
