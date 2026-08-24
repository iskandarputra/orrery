import type { Feature } from '../context'

const MARK_BY_NODE: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark'
}

/**
 * `**bold**`, `*italic*`, `~~struck~~` — the styling itself comes from the
 * markdown highlight style; this only conceals the marker characters when the
 * cursor is outside the construct.
 */
export const emphasis: Feature = {
  nodes: Object.keys(MARK_BY_NODE),
  enter(node, ctx) {
    if (ctx.revealed(node.from, node.to)) return
    const markName = MARK_BY_NODE[node.name]
    if (!markName) return
    for (const mark of node.node.getChildren(markName)) {
      ctx.conceal(mark.from, mark.to)
    }
  }
}
