import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { findEmoji, matchEmojiQuery } from './emoji'
import { filterSlashItems, matchSlashQuery, slashItems } from './slash-menu'

/**
 * `/` opens the insert menu.
 *
 * Every block type the editor renders — callouts, tables, diagrams, math — was
 * previously reachable only through the toolbar or by knowing the markdown.
 * This is the one interaction that makes them discoverable while typing.
 */
export function slashCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const match = matchSlashQuery(line.text, context.pos - line.from)
  if (!match) return null

  const items = filterSlashItems(slashItems(), match.query)
  if (items.length === 0) return null

  return {
    from: line.from + match.from,
    options: items.map((item) => ({
      label: item.label,
      detail: item.hint,
      type: 'keyword',
      // The typed `/query` is removed first, then the block is inserted where
      // it stood — one visible action, whatever the item does.
      apply: (view: EditorView, _completion: Completion, from: number, to: number): void => {
        view.dispatch({ changes: { from, to, insert: '' } })
        item.run()
      }
    })),
    // The query text starts with `/`, which no label matches, so CodeMirror's
    // own filter would discard every option. Filtering happens above instead,
    // and without `validFor` the source re-runs on each keystroke to narrow.
    filter: false
  }
}

/** `:name:` completes to the emoji itself, the way a picker would insert it. */
export function emojiCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const match = matchEmojiQuery(line.text, context.pos - line.from)
  if (!match) return null

  const found = findEmoji(match.query)
  if (found.length === 0) return null

  return {
    from: line.from + match.from,
    options: found.map((emoji) => ({
      label: `:${emoji.name}:`,
      detail: emoji.glyph,
      type: 'text',
      apply: emoji.glyph
    })),
    filter: false
  }
}
