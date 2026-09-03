import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { imageRendering } from './images'
import { mathRendering } from './math'
import { tableRendering } from './table'
import { parseFully } from './parse-fully'

/**
 * Clicking a rendered construct reveals the source it replaced — after the
 * document has moved underneath it.
 *
 * The bug this exists for is invisible on a document nobody has edited: the
 * widget is drawn once, holding the offset it had then, and every assertion
 * about a fresh editor agrees with it. It only shows once something above the
 * widget changes length and the widget is *not* rebuilt, which is the case
 * `eq()` is written to produce.
 */

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function mount(doc: string, extension: Extension): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), extension]
  })
  parseFully(state)
  view = new EditorView({ state, parent: document.body })
  return view
}

/**
 * The widget's own handler, and only it.
 *
 * Dispatched without bubbling so CodeMirror's mouse handling on the content
 * above never sees it — that path measures client rectangles, which jsdom has
 * none of, and it is not what this is testing.
 */
function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: false, cancelable: true }))
}

/** Insert text on the line above, moving everything below it along. */
function insertAbove(v: EditorView, text: string): void {
  v.dispatch({ changes: { from: 0, to: 0, insert: text } })
}

const CASES: {
  name: string
  doc: string
  source: string
  selector: string
  extension: () => Extension
}[] = [
  {
    name: 'an image',
    doc: 'intro\n\n![alt](https://example.com/a.png)\n',
    source: '![alt]',
    selector: '.cm-or-image',
    extension: () => imageRendering()
  },
  {
    name: 'a maths block',
    doc: 'intro\n\n$$\nx^2\n$$\n',
    source: '$$',
    selector: '.cm-or-math',
    extension: () => mathRendering()
  },
  {
    name: 'a table',
    doc: 'intro\n\n| A | B |\n| - | - |\n| 1 | 2 |\n',
    source: '| A | B |',
    selector: '.cm-or-table',
    extension: () => tableRendering()
  }
]

describe.each(CASES)('$name', ({ doc, source, selector, extension }) => {
  it('puts the cursor on its source when clicked', () => {
    const v = mount(doc, extension())
    const card = v.dom.querySelector<HTMLElement>(selector)
    expect(card).not.toBeNull()

    click(card!)
    expect(v.state.selection.main.anchor).toBe(doc.indexOf(source))
  })

  it('still does after the document above it has grown', () => {
    const v = mount(doc, extension())
    const before = v.dom.querySelector<HTMLElement>(selector)
    expect(before).not.toBeNull()

    insertAbove(v, 'XXXXXXXXXX')
    const after = v.dom.querySelector<HTMLElement>(selector)
    // The premise: the widget was *not* redrawn, because `eq()` ignores the
    // offset. If this ever stops holding, the test below stops being a test of
    // anything and should be rewritten rather than deleted.
    expect(after, 'the widget kept its DOM across the edit').toBe(before)

    const moved = v.state.doc.toString().indexOf(source)
    expect(moved).toBe(doc.indexOf(source) + 10)

    click(after!)
    expect(v.state.selection.main.anchor).toBe(moved)
  })
})

describe('the source it lands on', () => {
  it('is the source, not ten characters before it', () => {
    // The user-visible half of the same bug: a cursor that lands short is not
    // inside the construct, so the construct never reveals and the click looks
    // like it did nothing.
    const doc = 'intro\n\n![alt](https://example.com/a.png)\n'
    const v = mount(doc, imageRendering())
    insertAbove(v, 'XXXXXXXXXX')
    click(v.dom.querySelector<HTMLElement>('.cm-or-image')!)
    expect(v.dom.querySelector('.cm-or-image')).toBeNull()
    expect(v.dom.querySelector('.cm-content')?.textContent).toContain('![alt]')
  })
})
