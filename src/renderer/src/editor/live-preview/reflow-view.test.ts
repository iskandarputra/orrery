import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { buildReflowDecorations, reflowField, reflowParagraphs } from './reflow-view'
import { parseFully } from './parse-fully'

function decos(doc: string): { from: number; to: number }[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), reflowField, reflowParagraphs(true)]
  })
  parseFully(state)
  const set = buildReflowDecorations(state)
  const out: { from: number; to: number }[] = []
  const cursor = set.iter()
  while (cursor.value) {
    out.push({ from: cursor.from, to: cursor.to })
    cursor.next()
  }
  return out
}

describe('reflowParagraphs decorations', () => {
  it('joins internal newlines of a soft-wrapped paragraph', () => {
    const doc = 'one two\nthree four\nfive'
    const d = decos(doc)
    // Two internal newlines → two soft-space replacements over 1-char ranges.
    expect(d).toHaveLength(2)
    expect(doc.slice(d[0]!.from, d[0]!.to)).toBe('\n')
    expect(doc.slice(d[1]!.from, d[1]!.to)).toBe('\n')
  })

  it('does not join across paragraph (blank line) boundaries', () => {
    // Each paragraph is a single line → nothing to join.
    expect(decos('para one\n\npara two')).toHaveLength(0)
  })

  it('preserves markdown hard breaks (two trailing spaces)', () => {
    const d = decos('line one  \nline two')
    expect(d).toHaveLength(0)
  })

  it('leaves non-paragraph blocks (lists, code) alone', () => {
    expect(decos('- item one\n- item two')).toHaveLength(0)
    expect(decos('```\na\nb\n```')).toHaveLength(0)
  })

  it('renders paragraph as a single merged line in EditorView', () => {
    const doc = 'one two\nthree four\nfive'
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        reflowField,
        reflowParagraphs(true)
      ]
    })
    const view = new EditorView({ state })
    const lines = view.dom.querySelectorAll('.cm-line')
    expect(lines.length).toBe(1)
    expect(lines[0]?.textContent).toContain('one two')
    expect(lines[0]?.textContent).toContain('three four')
  })
})
