import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { getLinePrefixChanges, getSnippetInsertion } from './format-helpers'

function applyPrefix(doc: string, from: number, to: number, prefix: string): string {
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  const changes = getLinePrefixChanges(state, prefix)
  const tr = state.update({ changes })
  return tr.state.doc.toString()
}

describe('format-helpers', () => {
  describe('getLinePrefixChanges', () => {
    it('adds heading prefix to plain line', () => {
      const res = applyPrefix('Hello World', 0, 0, '# ')
      expect(res).toBe('# Hello World')
    })

    it('replaces existing heading prefix when different', () => {
      const res = applyPrefix('# Hello World', 0, 0, '## ')
      expect(res).toBe('## Hello World')
    })

    it('toggles off heading prefix when same', () => {
      const res = applyPrefix('# Hello World', 0, 0, '# ')
      expect(res).toBe('Hello World')
    })

    it('adds blockquote prefix', () => {
      const res = applyPrefix('Quoted line', 0, 0, '> ')
      expect(res).toBe('> Quoted line')
    })

    it('toggles off blockquote prefix', () => {
      const res = applyPrefix('> Quoted line', 0, 0, '> ')
      expect(res).toBe('Quoted line')
    })

    it('adds task list checkbox', () => {
      const res = applyPrefix('Do homework', 0, 0, '- [ ] ')
      expect(res).toBe('- [ ] Do homework')
    })

    it('toggles off task list checkbox', () => {
      const res = applyPrefix('- [ ] Do homework', 0, 0, '- [ ] ')
      expect(res).toBe('Do homework')
    })

    it('adds bullet list marker', () => {
      const res = applyPrefix('Item one', 0, 0, '- ')
      expect(res).toBe('- Item one')
    })

    it('toggles off bullet list marker', () => {
      const res = applyPrefix('- Item one', 0, 0, '- ')
      expect(res).toBe('Item one')
    })
  })

  describe('getSnippetInsertion', () => {
    it('replaces $SEL with selected text', () => {
      expect(getSnippetInsertion('**$SEL**', 'bold me')).toBe('**bold me**')
      expect(getSnippetInsertion('[$SEL](url)', 'my link')).toBe('[my link](url)')
    })

    it('falls back to default text if selected text is empty', () => {
      expect(getSnippetInsertion('**$SEL**', '')).toBe('**text**')
    })

    it('returns snippet as-is when no $SEL is present', () => {
      expect(getSnippetInsertion('---\n', '')).toBe('---\n')
    })
  })
})
