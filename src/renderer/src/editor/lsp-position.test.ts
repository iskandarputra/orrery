import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { offsetToPosition, positionToOffset } from './lsp-position'

const DOC = 'const a = 1\nconst b = 2\nlast'
const state = EditorState.create({ doc: DOC })

describe('positionToOffset', () => {
  it('converts a zero-based position into an offset', () => {
    // Line 1 (0-based) starts at offset 12; character 6 is 6 past that.
    expect(positionToOffset(state, { line: 1, character: 6 })).toBe(18)
  })

  it('handles the very first position', () => {
    expect(positionToOffset(state, { line: 0, character: 0 })).toBe(0)
  })

  it('clamps a line the document does not have', () => {
    expect(positionToOffset(state, { line: 99, character: 0 })).toBe(state.doc.line(3).from)
  })

  it('clamps a character past the end of its line', () => {
    expect(positionToOffset(state, { line: 0, character: 500 })).toBe(state.doc.line(1).to)
  })

  it('clamps a negative character rather than reaching into the line before', () => {
    expect(positionToOffset(state, { line: 1, character: -5 })).toBe(state.doc.line(2).from)
  })
})

describe('offsetToPosition', () => {
  it('converts an offset into a zero-based position', () => {
    expect(offsetToPosition(state, 18)).toEqual({ line: 1, character: 6 })
  })

  it('clamps an offset past the end of the document', () => {
    expect(offsetToPosition(state, 9999)).toEqual(offsetToPosition(state, DOC.length))
  })

  it('clamps a negative offset', () => {
    expect(offsetToPosition(state, -3)).toEqual({ line: 0, character: 0 })
  })
})

describe('round trip', () => {
  it('returns the offset it started from, for every offset in the document', () => {
    for (let offset = 0; offset <= DOC.length; offset++) {
      expect(positionToOffset(state, offsetToPosition(state, offset)), `offset ${offset}`).toBe(
        offset
      )
    }
  })
})
