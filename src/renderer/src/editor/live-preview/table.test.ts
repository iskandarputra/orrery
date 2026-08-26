import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { tableRendering } from './table'
import { parseFully } from './parse-fully'

const DOC = [
  '# Title',
  '',
  '| Name | Score |',
  '| :--- | ---: |',
  '| alpha | **1** |',
  '| beta | `2` |',
  '',
  'after'
].join('\n')

let view: EditorView | null = null

function mount(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage }), tableRendering()]
  })
  parseFully(state)
  view = new EditorView({ state, parent: document.body })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
})

describe('tableRendering', () => {
  it('replaces an idle table with a rendered widget', () => {
    const v = mount(DOC, 0)
    const table = v.dom.querySelector('.cm-zy-table table')
    expect(table).toBeTruthy()
    expect(v.dom.querySelectorAll('.cm-zy-table th')).toHaveLength(2)
    expect(v.dom.querySelectorAll('.cm-zy-table tbody tr')).toHaveLength(2)
    expect(v.dom.querySelector('.cm-zy-table strong')?.textContent).toBe('1')
    expect(v.dom.querySelector('.cm-zy-table code')?.textContent).toBe('2')
    // Raw pipes are gone from the visible text.
    expect(v.dom.querySelector('.cm-content')?.textContent).not.toContain('| Name |')
  })

  it('shows monospace source when the cursor is inside the table', () => {
    const cursorInTable = DOC.indexOf('alpha')
    const v = mount(DOC, cursorInTable)
    expect(v.dom.querySelector('.cm-zy-table table')).toBeNull()
    expect(v.dom.querySelectorAll('.cm-zy-table-src').length).toBeGreaterThanOrEqual(4)
  })

  it('switches between widget and source as the selection moves', () => {
    const v = mount(DOC, 0)
    expect(v.dom.querySelector('.cm-zy-table table')).toBeTruthy()
    v.dispatch({ selection: { anchor: DOC.indexOf('beta') } })
    expect(v.dom.querySelector('.cm-zy-table table')).toBeNull()
    v.dispatch({ selection: { anchor: 0 } })
    expect(v.dom.querySelector('.cm-zy-table table')).toBeTruthy()
  })

  it('leaves indented (blockquoted) tables as source', () => {
    const quoted = '> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n'
    const v = mount(quoted, quoted.length - 1)
    expect(v.dom.querySelector('.cm-zy-table table')).toBeNull()
  })
})
