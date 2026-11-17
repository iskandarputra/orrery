import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { mathRendering } from './math'

function decorations(state: EditorState): DecorationSet {
  const [source] = state.facet(EditorView.decorations)
  return (typeof source === 'function' ? source(null as never) : source) as DecorationSet
}

/** Each rendered equation as `from-to:expr`, block ones marked. */
function rendered(state: EditorState): string[] {
  const out: string[] = []
  decorations(state).between(0, state.doc.length, (from, to, deco) => {
    const widget = deco.spec.widget as { expr: string; display: boolean }
    out.push(`${from}-${to}:${widget.expr}${widget.display ? ' (block)' : ''}`)
  })
  return out
}

function stateOf(doc: string, cursor = 0, reveal = true): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [mathRendering(reveal), EditorState.allowMultipleSelections.of(true)]
  })
}

const DOC = ['intro $a+b$ text', '', '$$', 'E = mc^2', '$$', '', 'after $c$'].join('\n')

describe('mathRendering', () => {
  it('renders inline and block equations, in order', () => {
    expect(rendered(stateOf(DOC, 13))).toEqual(['6-11:a+b', '18-32:E = mc^2 (block)', '40-43:c'])
  })

  it('leaves prices, padded dollars and fenced code alone', () => {
    const doc = ['costs $5 or $10', 'a $ b$ c', '```', '$x$', '```', '$y$'].join('\n')
    expect(rendered(stateOf(doc, 0))).toEqual([`${doc.length - 3}-${doc.length}:y`])
  })

  it('does not render an inline match that sits inside a block', () => {
    const doc = '$$\nd$e$f\n$$'
    expect(rendered(stateOf(doc, 0, false))).toEqual(['0-11:d$e$f (block)'])
  })

  it('shows the source of the equation under the cursor, and only that one', () => {
    const inside = stateOf(DOC, 8)
    expect(rendered(inside)).toEqual(['18-32:E = mc^2 (block)', '40-43:c'])
    const moved = inside.update({ selection: EditorSelection.cursor(DOC.length) }).state
    expect(rendered(moved)).toEqual(['6-11:a+b', '18-32:E = mc^2 (block)'])
  })

  it('counts a cursor against either edge as touching', () => {
    expect(rendered(stateOf(DOC, 6))).not.toContain('6-11:a+b')
    expect(rendered(stateOf(DOC, 11))).not.toContain('6-11:a+b')
    expect(rendered(stateOf(DOC, 12))).toContain('6-11:a+b')
  })

  it('keeps the same decorations when the cursor moves between equations', () => {
    // The whole point of scanning once: a move that enters and leaves nothing
    // must not rebuild, since rebuilding was 13.6ms a keypress on a long note.
    const before = stateOf(DOC, 13)
    const after = before.update({ selection: EditorSelection.cursor(15) }).state
    expect(rendered(after)).toEqual(rendered(before))
    expect(decorations(after)).toBe(decorations(before))
  })

  it('rebuilds when the cursor does enter an equation', () => {
    const before = stateOf(DOC, 13)
    const after = before.update({ selection: EditorSelection.cursor(20) }).state
    expect(decorations(after)).not.toBe(decorations(before))
    expect(rendered(after)).toEqual(['6-11:a+b', '40-43:c'])
  })

  it('reveals for every range of a multiple selection', () => {
    const state = stateOf(DOC).update({
      selection: EditorSelection.create([EditorSelection.cursor(7), EditorSelection.cursor(41)])
    }).state
    expect(rendered(state)).toEqual(['18-32:E = mc^2 (block)'])
  })

  it('never reveals in reading mode', () => {
    expect(rendered(stateOf(DOC, 8, false))).toEqual([
      '6-11:a+b',
      '18-32:E = mc^2 (block)',
      '40-43:c'
    ])
  })

  it('follows an edit that adds an equation', () => {
    const state = stateOf(DOC, 13).update({ changes: { from: 0, insert: '$z$ ' } }).state
    expect(rendered(state)[0]).toBe('0-3:z')
    expect(rendered(state)).toHaveLength(4)
  })
})
