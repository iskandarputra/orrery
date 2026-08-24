import type { MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

const EQ = 61 // '='

/**
 * ==highlighted text== inline syntax (Obsidian-compatible). Follows the same
 * delimiter pattern as @lezer/markdown's Strikethrough extension; the visual
 * treatment comes from the live-preview `highlight` feature.
 */
export const HighlightExtension: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight' },
    { name: 'HighlightMark', style: tags.processingInstruction }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== EQ || cx.char(pos + 1) !== EQ || cx.char(pos + 2) === EQ) return -1
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, true)
      },
      after: 'Emphasis'
    }
  ]
}
