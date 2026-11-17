import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { forceParsing, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { revealField, type Revealable } from './reveal-field'

const hidden = Decoration.mark({ class: 'rendered' })
const source = Decoration.mark({ class: 'source' })

/** Every `@word` in the text is a construct: rendered idle, source when touched. */
function words(state: EditorState): Revealable[] {
  scans++
  const items: Revealable[] = []
  for (const m of state.doc.toString().matchAll(/@\w+/g)) {
    const from = m.index
    const to = from + m[0].length
    items.push({ from, to, shown: [hidden.range(from, to)], revealed: [source.range(from, to)] })
  }
  return items
}
let scans = 0

function decorations(state: EditorState): DecorationSet {
  const [provided] = state.facet(EditorView.decorations)
  return (typeof provided === 'function' ? provided(null as never) : provided) as DecorationSet
}

function marks(state: EditorState): string[] {
  const out: string[] = []
  decorations(state).between(0, state.doc.length, (from, to, deco) => {
    out.push(`${from}-${to}:${deco.spec.class as string}`)
  })
  return out
}

function stateOf(doc: string, cursor: number, reveal = true): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [revealField(words, reveal), EditorState.allowMultipleSelections.of(true)]
  })
}

const DOC = '@one and @two'

describe('revealField', () => {
  it('shows what is touched as source and the rest rendered', () => {
    expect(marks(stateOf(DOC, 2))).toEqual(['0-4:source', '9-13:rendered'])
    expect(marks(stateOf(DOC, 6))).toEqual(['0-4:rendered', '9-13:rendered'])
  })

  it('counts both edges as touching', () => {
    expect(marks(stateOf(DOC, 4))[0]).toBe('0-4:source')
    expect(marks(stateOf(DOC, 9))[1]).toBe('9-13:source')
  })

  it('does not scan again, or rebuild, for a move that touches nothing new', () => {
    const before = stateOf(DOC, 5)
    scans = 0
    const after = before.update({ selection: EditorSelection.cursor(7) }).state
    expect(scans).toBe(0)
    expect(decorations(after)).toBe(decorations(before))
  })

  it('swaps without scanning when the cursor crosses into a construct', () => {
    const before = stateOf(DOC, 5)
    scans = 0
    const after = before.update({ selection: EditorSelection.cursor(11) }).state
    expect(scans).toBe(0)
    expect(marks(after)).toEqual(['0-4:rendered', '9-13:source'])
  })

  it('scans again when the text changes', () => {
    const before = stateOf(DOC, 6)
    scans = 0
    const state = before.update({ changes: { from: DOC.length, insert: ' @three' } }).state
    expect(scans).toBe(1)
    expect(marks(state)).toEqual(['0-4:rendered', '9-13:rendered', '14-20:rendered'])
  })

  it('reveals for every range of a multiple selection', () => {
    const state = stateOf(DOC, 0).update({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(10)])
    }).state
    expect(marks(state)).toEqual(['0-4:source', '9-13:source'])
  })

  it('never reveals when reveal is off', () => {
    const state = stateOf(DOC, 2, false)
    expect(marks(state)).toEqual(['0-4:rendered', '9-13:rendered'])
    expect(marks(state.update({ selection: EditorSelection.cursor(10) }).state)).toEqual([
      '0-4:rendered',
      '9-13:rendered'
    ])
  })

  it('scans again as the parse advances, only when asked to follow it', () => {
    // Long enough that creating the state cannot parse all of it, so forcing
    // the parse on brings a new tree in a transaction that changes no text.
    const doc = '# Heading\n\nSome *text* here.\n\n'.repeat(20000)
    for (const followParse of [true, false]) {
      let seen = 0
      const counting = (): Revealable[] => {
        seen++
        return []
      }
      const view = new EditorView({
        state: EditorState.create({
          doc,
          extensions: [
            markdown({ base: markdownLanguage }),
            revealField(counting, true, { followParse })
          ]
        }),
        parent: document.body
      })
      const tree = syntaxTree(view.state)
      expect(tree.length).toBeLessThan(doc.length)
      const before = seen
      forceParsing(view, doc.length, 5000)
      expect(syntaxTree(view.state)).not.toBe(tree)
      expect(seen > before).toBe(followParse)
      view.destroy()
    }
  })
})
