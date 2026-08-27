import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { HighlightExtension } from '../markdown/highlight-extension'
import { highlight } from './features/highlight'
import { buildDecorationRanges } from './plugin'
import { parseFully } from './parse-fully'

function build(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage, extensions: [HighlightExtension] })]
  })
  parseFully(state)
  return buildDecorationRanges(state, [highlight], [{ from: 0, to: state.doc.length }])
}

describe('==highlight== live preview', () => {
  it('marks the span and conceals == when the cursor is outside', () => {
    const doc = 'keep ==this safe== ok'
    const result = build(doc, 0)
    const conceals = result.conceals.map((r) => doc.slice(r.from, r.to))
    expect(conceals.filter((s) => s === '==')).toHaveLength(2)
    const mark = result.all.find(
      (r) => (r.value as { spec?: { class?: string } }).spec?.class === 'cm-or-mark'
    )
    expect(mark).toBeDefined()
    expect(doc.slice(mark!.from, mark!.to)).toBe('==this safe==')
  })

  it('reveals the markers when the cursor is inside', () => {
    const doc = 'keep ==this safe== ok'
    const result = build(doc, 9)
    expect(result.conceals).toHaveLength(0)
  })

  it('does not fire without a closing pair', () => {
    const result = build('lonely == marker', 0)
    expect(result.all).toHaveLength(0)
  })
})
