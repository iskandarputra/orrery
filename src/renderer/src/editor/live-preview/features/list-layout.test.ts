import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blockSpacing } from './block-spacing'
import { lists } from './lists'
import { buildDecorationRanges, type BuiltDecorations } from '../plugin'
import { parseFully } from '../parse-fully'

const FEATURES = [lists({ fancyBullets: true, interactiveCheckboxes: true }), blockSpacing]

function build(doc: string, cursor = 0): { state: EditorState; result: BuiltDecorations } {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })]
  })
  parseFully(state)
  return { state, result: buildDecorationRanges(state, FEATURES, [{ from: 0, to: doc.length }]) }
}

function lineStyle(state: EditorState, result: BuiltDecorations, lineNo: number): string {
  const line = state.doc.line(lineNo)
  return result.all
    .filter((r) => r.from === line.from && r.to === line.from)
    .map((r) => (r.value.spec as { attributes?: Record<string, string> }).attributes?.['style'] ?? '')
    .join(' ')
}

const concealed = (doc: string, result: BuiltDecorations): string[] =>
  result.conceals.map((r) => JSON.stringify(doc.slice(r.from, r.to)))

describe('list depth', () => {
  it('indents by nesting, not by how many spaces were typed', () => {
    const twoSpace = '- one\n  - two\n    - three\n'
    const fourSpace = '- one\n    - two\n        - three\n'
    const a = build(twoSpace)
    const b = build(fourSpace)
    // The same document meaning must render at the same depth.
    for (const line of [1, 2, 3]) {
      expect(lineStyle(a.state, a.result, line)).toBe(lineStyle(b.state, b.result, line))
    }
  })

  it('counts depth from zero at the top level', () => {
    const { state, result } = build('- one\n  - two\n    - three\n')
    expect(lineStyle(state, result, 1)).toContain('--zy-li-depth: 0')
    expect(lineStyle(state, result, 2)).toContain('--zy-li-depth: 1')
    expect(lineStyle(state, result, 3)).toContain('--zy-li-depth: 2')
  })

  it('treats an ordered list the same way', () => {
    const { state, result } = build('1. one\n   1. two\n')
    expect(lineStyle(state, result, 1)).toContain('--zy-li-depth: 0')
    expect(lineStyle(state, result, 2)).toContain('--zy-li-depth: 1')
  })

  it('nests a bullet under an ordered parent', () => {
    const { state, result } = build('1. parent\n   - child\n')
    expect(lineStyle(state, result, 2)).toContain('--zy-li-depth: 1')
  })
})

describe('leading indentation', () => {
  it('hides the spaces that encoded the nesting', () => {
    // Depth drives the visual indent now, so the source spaces must not add
    // to it — otherwise 4-space nesting sits twice as deep as 2-space.
    const doc = '- one\n    - two\n'
    const { result } = build(doc, 0)
    expect(concealed(doc, result)).toContain('"    "')
  })

  it('leaves the spaces visible on the line being edited', () => {
    const doc = '- one\n    - two\n'
    const { result } = build(doc, doc.indexOf('- two'))
    expect(concealed(doc, result)).not.toContain('"    "')
  })

  it('has nothing to hide at the top level', () => {
    const doc = '- one\n- two\n'
    const { result } = build(doc, 0)
    expect(concealed(doc, result).filter((s) => s.trim() === '""')).toEqual([])
  })
})

describe('ordered markers', () => {
  it('marks the number so it can hold a fixed column', () => {
    const { result } = build('1. one\n10. ten\n')
    const marks = result.all.filter((r) =>
      ((r.value.spec as { class?: string }).class ?? '').includes('cm-zy-ordered-mark')
    )
    expect(marks).toHaveLength(2)
  })

  it('leaves bullet markers to the widget', () => {
    const { result } = build('- one\n')
    const marks = result.all.filter((r) =>
      ((r.value.spec as { class?: string }).class ?? '').includes('cm-zy-ordered-mark')
    )
    expect(marks).toEqual([])
  })
})

describe('task markers', () => {
  it('hides the space behind the list mark so the checkbox holds the column', () => {
    const doc = '- [ ] task\n'
    const { result } = build(doc, doc.length)
    // `- ` goes as one piece: leaving the space would shift the checkbox right
    // of a plain bullet, giving a mixed list two text edges.
    expect(concealed(doc, result)).toContain('"- "')
  })

  it('still shows the source on the line being edited', () => {
    const doc = '- [ ] task\n'
    const { result } = build(doc, 3)
    expect(concealed(doc, result)).not.toContain('"- "')
  })
})
