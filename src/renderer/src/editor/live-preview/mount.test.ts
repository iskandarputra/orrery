import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { composeLivePreview } from './compose'
import { livePreview } from './index'
import { parseFully } from './parse-fully'

/**
 * Mounting a real `EditorView`, which nothing else here does.
 *
 * The other tests in this directory call `buildDecorationRanges` and inspect
 * what comes back, which never exercises the one rule CodeMirror enforces at
 * mount: a decoration that replaces a line break may not come from a
 * ViewPlugin. A whole suite of green tests said nothing about a document that
 * threw `RangeError` the moment it was opened, because no test ever opened one.
 */

const views: EditorView[] = []

afterEach(() => {
  while (views.length > 0) views.pop()!.destroy()
})

function mount(doc: string, reveal: boolean): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [markdown({ base: markdownLanguage }), livePreview({ reveal })]
  })
  parseFully(state)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

const MULTILINE_COMMENT = 'before\n\n<!--\n  a private note\n  over three lines\n-->\n\nafter\n'

describe('a multi-line HTML comment in Reading mode', () => {
  it('opens without throwing', () => {
    // The conceal covered the whole comment node, line breaks included, and
    // was served from the live-preview ViewPlugin. CodeMirror rejects that at
    // mount, so opening any note with a multi-line comment crashed the pane.
    expect(() => mount(MULTILINE_COMMENT, false)).not.toThrow()
  })

  it('still hides the comment', () => {
    // The point of the feature, and the reason the fix cannot simply stop
    // concealing: Reading mode is a rendered document, and a comment is not
    // content in one.
    const text = mount(MULTILINE_COMMENT, false).dom.textContent ?? ''
    expect(text).toContain('before')
    expect(text).toContain('after')
    expect(text).not.toContain('a private note')
  })

  it('leaves it visible while editing, where hiding text would be a trap', () => {
    const text = mount(MULTILINE_COMMENT, true).dom.textContent ?? ''
    expect(text).toContain('a private note')
  })
})

describe('an embedded note or hover preview', () => {
  it('mounts a note holding a multi-line comment', () => {
    // `preview-view` composes with `reveal: false`, so every embed and every
    // link-hover preview is a Reading-mode document. The crash was not
    // confined to Reading mode: embedding a note with a multi-line comment,
    // or hovering a link to one, hit it while editing normally.
    const state = EditorState.create({
      doc: MULTILINE_COMMENT,
      extensions: [markdown({ base: markdownLanguage }), composeLivePreview({ reveal: false })]
    })
    parseFully(state)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    expect(() => views.push(new EditorView({ state, parent }))).not.toThrow()
  })
})

/**
 * Representative shapes, mounted in both modes. Cheap, and they are the reason
 * to believe the comment was the only decoration breaking the rule rather than
 * the first one found.
 */
const SHAPES: Record<string, string> = {
  'single-line comment': 'text\n\n<!-- one line -->\n\nafter\n',
  'html block': 'text\n\n<div class="x">\n  <p>hi</p>\n</div>\n\nafter\n',
  'fenced code': 'text\n\n```ts\nconst a = 1\nconst b = 2\n```\n\nafter\n',
  mermaid: 'text\n\n```mermaid\ngraph TD\nA-->B\n```\n\nafter\n',
  table: '| a | b |\n| - | - |\n| 1 | 2 |\n',
  frontmatter: '---\ntitle: x\n---\n\nbody\n',
  'math block': 'text\n\n$$\nx = 1\n$$\n\nafter\n',
  'nested list': '- a\n    - b\n        - c\n',
  callout: '> [!NOTE] Title\n> body line\n> more body\n',
  footnote: 'a ref[^1]\n\n[^1]: the definition\n',
  embed: 'text\n\n![[Other Note]]\n\nafter\n',
  'indented code': 'text\n\n    indented\n    code\n\nafter\n'
}

describe('mounting every shape', () => {
  for (const [name, doc] of Object.entries(SHAPES)) {
    it(`does not throw in Reading mode: ${name}`, () => {
      expect(() => mount(doc, false)).not.toThrow()
    })
    it(`does not throw while editing: ${name}`, () => {
      expect(() => mount(doc, true)).not.toThrow()
    })
  }
})
