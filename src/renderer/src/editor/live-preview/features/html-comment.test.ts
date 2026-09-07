import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { htmlComment } from './html-comment'
import { buildDecorationRanges, type BuiltDecorations } from '../plugin'
import { parseFully } from '../parse-fully'

/**
 * A conceal that crosses a line break crashes the editor.
 *
 * CodeMirror refuses a replacing decoration spanning a line end when it comes
 * from a view plugin, and every feature here runs inside one:
 * `@codemirror/view` throws "Decorations that replace line breaks may not be
 * specified via plugins", the pane's React tree unmounts, and the whole window
 * goes blank with nothing on screen to say why.
 *
 * Reading mode is where this bit. A one line comment conceals inside its line
 * and is fine; a comment written across several lines was concealed in one
 * span from `<!--` to `-->` and took the line breaks with it. Nothing caught
 * it because the e2e suite opens every vault in live mode, and the two
 * userData directories that exist on a developer's machine were in live and
 * source mode respectively.
 */
function build(doc: string, reveal: boolean): { state: EditorState; result: BuiltDecorations } {
  const state = EditorState.create({
    doc,
    // Away from the comment, so nothing is revealed by the cursor sitting in it.
    selection: EditorSelection.cursor(doc.length),
    extensions: [markdown({ base: markdownLanguage })]
  })
  parseFully(state)
  const result = buildDecorationRanges(
    state,
    [htmlComment],
    [{ from: 0, to: state.doc.length }],
    reveal
  )
  return { state, result }
}

/** Every conceal that starts on one line and ends on another. */
function crossingConceals(
  state: EditorState,
  result: BuiltDecorations
): { from: number; to: number }[] {
  return result.conceals
    .filter((r) => r.to > state.doc.lineAt(r.from).to)
    .map((r) => ({ from: r.from, to: r.to }))
}

const MULTILINE = `<!--
  written across
  several lines
-->

# Title
`

describe('a comment written across several lines', () => {
  it('is never concealed by a decoration that crosses a line break, in reading mode', () => {
    // The crash, as a test. Reading mode is `reveal: false`.
    const { state, result } = build(MULTILINE, false)
    expect(crossingConceals(state, result)).toEqual([])
  })

  it('is never concealed by a decoration that crosses a line break, in live mode', () => {
    const { state, result } = build(MULTILINE, true)
    expect(crossingConceals(state, result)).toEqual([])
  })

  it('still hides the comment in reading mode rather than leaving it on screen', () => {
    // Guards the other direction: a fix that simply stopped concealing would
    // pass the tests above and show raw `<!--` to somebody reading a note.
    const { result } = build(MULTILINE, false)
    const hidden = result.conceals.reduce((sum, r) => sum + (r.to - r.from), 0)
    const commentLength = MULTILINE.indexOf('-->') + '-->'.length
    expect(hidden).toBeGreaterThan(commentLength / 2)
  })
})

describe('a comment on one line', () => {
  it('is concealed whole, since that cannot cross anything', () => {
    const doc = `text\n<!-- just here -->\nmore\n`
    const { state, result } = build(doc, false)
    expect(crossingConceals(state, result)).toEqual([])
    const line = state.doc.line(2)
    expect(result.conceals.some((r) => r.from >= line.from && r.to <= line.to)).toBe(true)
  })
})
