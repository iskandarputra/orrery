import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { computeStats } from './editor-stats'

const doc = 'One two three\n\nfour five.\nsix'

describe('computeStats', () => {
  it('counts words and characters of the whole document', () => {
    const state = EditorState.create({ doc })
    expect(computeStats(state)).toMatchObject({ words: 6, characters: doc.length })
  })

  it('reports the document line count, not the cursor line', () => {
    // Cursor parked on line 3 — the total must stay 4.
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(16) })
    const stats = computeStats(state)
    expect(stats.lines).toBe(4)
    expect(stats.line).toBe(3) // cursor position, for the status bar
    expect(stats.column).toBe(2)
  })

  it('handles an empty document', () => {
    expect(computeStats(EditorState.create({ doc: '' }))).toEqual({
      words: 0,
      characters: 0,
      lines: 1,
      line: 1,
      column: 1
    })
  })
})
