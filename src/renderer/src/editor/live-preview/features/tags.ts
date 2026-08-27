import { Decoration } from '@codemirror/view'
import { findTags } from '@core/tags'
import type { Feature } from '../context'

const tagMark = Decoration.mark({ class: 'cm-or-tag' })

/**
 * `#tag` renders as a pill.
 *
 * Driven off `Paragraph` and heading nodes rather than the whole document, so
 * fenced code and inline code — where `#include` and `#define` live — are never
 * scanned. The shared parser applies the same rules the vault index uses, so
 * what looks like a tag and what gets indexed can't drift apart.
 */
export const tags: Feature = {
  nodes: ['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ListItem'],
  enter(node, ctx) {
    const text = ctx.state.doc.sliceString(node.from, node.to)
    for (const match of findTags(text)) {
      ctx.add(tagMark.range(node.from + match.from, node.from + match.to))
    }
  }
}
