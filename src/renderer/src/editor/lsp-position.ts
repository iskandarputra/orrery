import type { EditorState } from '@codemirror/state'

/** A position as the protocol spells it: both counted from zero. */
export interface LspPosition {
  line: number
  character: number
}

/**
 * Protocol position to document offset.
 *
 * The protocol counts lines from zero and the document counts from one, and a
 * server can name a position the document no longer has — answers arrive
 * asynchronously, so the file may have been edited under them. Out-of-range
 * positions are clamped rather than dropped: roughly the right place is still
 * useful, and an unclamped offset throws inside CodeMirror.
 */
export function positionToOffset(state: EditorState, position: LspPosition): number {
  const lineNumber = Math.min(Math.max(position.line + 1, 1), state.doc.lines)
  const line = state.doc.line(lineNumber)
  return Math.min(line.from + Math.max(position.character, 0), line.to)
}

/** Document offset to protocol position. */
export function offsetToPosition(state: EditorState, offset: number): LspPosition {
  const clamped = Math.min(Math.max(offset, 0), state.doc.length)
  const line = state.doc.lineAt(clamped)
  return { line: line.number - 1, character: clamped - line.from }
}
