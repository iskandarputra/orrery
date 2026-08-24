import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { toggleInlineMarkSpec } from './inline-format'

function apply(doc: string, from: number, to: number): { doc: string; sel: [number, number] } {
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  const tr = state.update(toggleInlineMarkSpec(state, '=='))
  const main = tr.state.selection.main
  return { doc: tr.state.doc.toString(), sel: [main.from, main.to] }
}

describe('toggleInlineMarkSpec (==)', () => {
  it('wraps a selection and keeps it selected', () => {
    const r = apply('pick me please', 5, 7)
    expect(r.doc).toBe('pick ==me== please')
    expect(r.sel).toEqual([7, 9]) // still around "me"
  })

  it('unwraps when the selection sits inside the markers', () => {
    const r = apply('pick ==me== please', 7, 9)
    expect(r.doc).toBe('pick me please')
    expect(r.sel).toEqual([5, 7])
  })

  it('strips markers included in the selection', () => {
    const r = apply('pick ==me== please', 5, 11)
    expect(r.doc).toBe('pick me please')
    expect(r.sel).toEqual([5, 7])
  })

  it('inserts a caret-ready pair on empty selection', () => {
    const r = apply('note ', 5, 5)
    expect(r.doc).toBe('note ====')
    expect(r.sel).toEqual([7, 7]) // caret between the markers
  })

  it('handles multiple cursors independently', () => {
    const state = EditorState.create({
      doc: 'aa bb',
      selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]),
      extensions: EditorState.allowMultipleSelections.of(true)
    })
    const tr = state.update(toggleInlineMarkSpec(state, '=='))
    expect(tr.state.doc.toString()).toBe('==aa== ==bb==')
  })
})
