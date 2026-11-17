import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { footnoteRendering } from './footnotes'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function mount(doc: string, cursor = doc.length): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [footnoteRendering()]
    }),
    parent: document.body
  })
  return view
}

/** The numbers the markers show, top to bottom. */
function markers(v: EditorView): string[] {
  return [...v.dom.querySelectorAll('.cm-or-footnote')].map((el) => el.textContent ?? '')
}

const DOC = ['First[^a] and second[^b].', '', '[^a]: one', '[^b]: two'].join('\n')

describe('footnoteRendering', () => {
  it('numbers the markers in reading order', () => {
    expect(markers(mount(DOC))).toEqual(['1', '2'])
  })

  it('shows the source of the marker under the cursor', () => {
    const v = mount(DOC)
    v.dispatch({ selection: EditorSelection.cursor(7) })
    expect(markers(v)).toEqual(['2'])
    v.dispatch({ selection: EditorSelection.cursor(DOC.length) })
    expect(markers(v)).toEqual(['1', '2'])
  })

  it('renumbers after an edit, since what was found belongs to the old text', () => {
    // The scan is kept between cursor moves; this is what says it is dropped
    // when the text it came from is replaced.
    const v = mount(DOC)
    v.dispatch({ selection: EditorSelection.cursor(DOC.length - 1) })
    v.dispatch({ changes: { from: 0, insert: 'Zeroth[^b] ' } })
    expect(markers(v)).toEqual(['1', '2', '1'])
  })
})
