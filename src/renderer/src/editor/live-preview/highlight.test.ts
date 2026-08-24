import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { HighlightExtension } from '../markdown/highlight-extension'
import { highlight } from './features/highlight'
import { buildDecorationRanges } from './plugin'

function build(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage, extensions: [HighlightExtension] })]
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return buildDecorationRanges(state, [highlight], [{ from: 0, to: state.doc.length }])
}

describe('==highlight== live preview', () => {
  it('marks the span and conceals == when the cursor is outside', () => {
    const doc = 'keep ==this safe== ok'
    const result = build(doc, 0)
    const conceals = result.conceals.map((r) => doc.slice(r.from, r.to))
    expect(conceals.filter((s) => s === '==')).toHaveLength(2)
    const mark = result.all.find(
      (r) => (r.value as { spec?: { class?: string } }).spec?.class === 'cm-zy-mark'
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
