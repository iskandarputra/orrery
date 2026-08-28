import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { gitGutter, markedLines, setGitChanges } from './git-gutter'

const withMarks = (doc: string, changes: Parameters<typeof setGitChanges.of>[0]): EditorState => {
  const state = EditorState.create({ doc, extensions: [gitGutter()] })
  return state.update({ effects: setGitChanges.of(changes) }).state
}

const DOC = 'one\ntwo\nthree\nfour\n'

describe('git gutter marks', () => {
  it('places a mark on the line the diff named', () => {
    const state = withMarks(DOC, [{ line: 2, kind: 'modified' }])
    expect(markedLines(state)).toEqual([{ line: 2, kind: 'modified' }])
  })

  it('follows the code when a line is inserted above it', () => {
    // The whole point of anchoring to positions rather than line numbers: a
    // gutter that points one line off is worse than none, because it is believed.
    const before = withMarks(DOC, [{ line: 2, kind: 'modified' }])
    const after = before.update({ changes: { from: 0, insert: 'inserted\n' } }).state
    expect(markedLines(after)).toEqual([{ line: 3, kind: 'modified' }])
  })

  it('follows the code when a line above it is removed', () => {
    const before = withMarks(DOC, [{ line: 3, kind: 'added' }])
    // Drop line 1 entirely.
    const after = before.update({ changes: { from: 0, to: 4 } }).state
    expect(markedLines(after)).toEqual([{ line: 2, kind: 'added' }])
  })

  it('leaves marks alone when the edit is below them', () => {
    const before = withMarks(DOC, [{ line: 1, kind: 'added' }])
    const after = before.update({ changes: { from: DOC.length, insert: 'five\n' } }).state
    expect(markedLines(after)).toEqual([{ line: 1, kind: 'added' }])
  })

  it('replaces the whole set when a fresh diff arrives', () => {
    const first = withMarks(DOC, [{ line: 1, kind: 'added' }])
    const second = first.update({ effects: setGitChanges.of([{ line: 4, kind: 'removed' }]) }).state
    expect(markedLines(second)).toEqual([{ line: 4, kind: 'removed' }])
  })

  it('ignores a line the document does not have', () => {
    // A diff computed a moment ago can name a line that has since gone.
    const state = withMarks(DOC, [
      { line: 2, kind: 'modified' },
      { line: 99, kind: 'added' }
    ])
    expect(markedLines(state)).toEqual([{ line: 2, kind: 'modified' }])
  })
})
