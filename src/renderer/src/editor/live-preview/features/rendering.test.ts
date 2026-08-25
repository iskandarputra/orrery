import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blockSpacing } from './block-spacing'
import { blockquote } from './blockquote'
import { codeBlock } from './code-block'
import { links } from './links'
import { lists } from './lists'
import { buildDecorationRanges, type BuiltDecorations } from '../plugin'

const FEATURES = [
  links({ renderImages: false }),
  lists({ fancyBullets: true, interactiveCheckboxes: true }),
  blockSpacing,
  blockquote,
  codeBlock
]

function build(doc: string, cursor = doc.length): { state: EditorState; result: BuiltDecorations } {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })]
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const result = buildDecorationRanges(state, FEATURES, [{ from: 0, to: state.doc.length }])
  return { state, result }
}

/** Line classes applied to the 1-based line number. */
function lineClasses(state: EditorState, result: BuiltDecorations, lineNo: number): string[] {
  const line = state.doc.line(lineNo)
  return result.all
    .filter((r) => r.from === line.from && r.to === line.from)
    .flatMap((r) => {
      const cls = (r.value.spec as { class?: string }).class
      return cls ? cls.split(' ') : []
    })
}

function lineAttrs(state: EditorState, result: BuiltDecorations, lineNo: number): string {
  const line = state.doc.line(lineNo)
  return result.all
    .filter((r) => r.from === line.from && r.to === line.from)
    .map((r) => (r.value.spec as { attributes?: Record<string, string> }).attributes?.['style'] ?? '')
    .join(' ')
}

function concealedSpans(doc: string, result: BuiltDecorations): string[] {
  return result.conceals.map((r) => doc.slice(r.from, r.to))
}

describe('indented code blocks', () => {
  it('styles a 4-space indented code block like a fenced one', () => {
    const doc = 'para\n\n    indented code\n    more code\n\nend'
    const { state, result } = build(doc)
    expect(lineClasses(state, result, 3)).toContain('cm-zy-code-line')
    expect(lineClasses(state, result, 3)).toContain('cm-zy-code-first')
    expect(lineClasses(state, result, 4)).toContain('cm-zy-code-line')
    expect(lineClasses(state, result, 4)).toContain('cm-zy-code-last')
  })

  it('leaves ordinary paragraphs untouched', () => {
    const doc = 'para\n\nend'
    const { state, result } = build(doc)
    expect(lineClasses(state, result, 1)).not.toContain('cm-zy-code-line')
  })
})

describe('blockquote continuation marks', () => {
  it('conceals the > on every line of a lazily continued paragraph', () => {
    const doc = '> line one\n> line two\n\nplain'
    const { result } = build(doc)
    expect(concealedSpans(doc, result).filter((s) => s === '> ')).toHaveLength(2)
  })

  it('conceals marks once for nested blockquotes', () => {
    const doc = '> outer\n> > inner\n\nplain'
    const { result } = build(doc)
    const marks = concealedSpans(doc, result).filter((s) => s.startsWith('>'))
    expect(new Set(result.conceals.map((r) => `${r.from}:${r.to}`)).size).toBe(marks.length)
  })
})

describe('callouts', () => {
  it('conceals the [!NOTE] marker instead of rendering it as a link', () => {
    const doc = '> [!NOTE] Heads up\n> body\n\nplain'
    const { state, result } = build(doc)
    expect(concealedSpans(doc, result)).toContain('[!NOTE] ')
    const linkDecos = result.all.filter((r) =>
      ((r.value.spec as { class?: string }).class ?? '').includes('cm-zy-link-text')
    )
    expect(linkDecos).toHaveLength(0)
    expect(lineClasses(state, result, 1)).toContain('cm-zy-callout--note')
  })

  it('marks the callout title text', () => {
    const doc = '> [!WARNING] Be careful\n> body\n\nplain'
    const { result } = build(doc)
    const title = result.all.find((r) =>
      ((r.value.spec as { class?: string }).class ?? '').includes('cm-zy-callout-title')
    )
    expect(title).toBeDefined()
    expect(doc.slice(title!.from, title!.to)).toBe('Be careful')
  })
})

describe('list hanging indent', () => {
  it('offsets wrapped lines to the item text column', () => {
    const doc = '- top level item\n  - nested item\n'
    const { state, result } = build(doc)
    // "- "  → marker 1ch + space 0.5ch
    expect(lineAttrs(state, result, 1)).toContain('padding-left: 1.5ch')
    expect(lineAttrs(state, result, 1)).toContain('text-indent: -1.5ch')
    // "  - " → two spaces (1ch) on top of that
    expect(lineAttrs(state, result, 2)).toContain('padding-left: 2.5ch')
  })

  it('accounts for ordered list markers', () => {
    const doc = '1. first\n10. tenth\n'
    const { state, result } = build(doc)
    expect(lineAttrs(state, result, 1)).toContain('padding-left: 2.5ch')
    expect(lineAttrs(state, result, 2)).toContain('padding-left: 3.5ch')
  })
})

describe('fence marks', () => {
  const doc = 'text\n\n```ts\nconst a = 1\n```\n\nend'

  it('conceals ``` on both fences when the cursor is elsewhere', () => {
    const { result } = build(doc, 0)
    expect(concealedSpans(doc, result).filter((s) => s === '```')).toHaveLength(2)
  })

  it('keeps the language badge on the concealed opening fence', () => {
    const { result } = build(doc, 0)
    const badge = result.all.find((r) =>
      ((r.value.spec as { class?: string }).class ?? '').includes('cm-zy-code-info')
    )
    expect(badge).toBeDefined()
    expect(doc.slice(badge!.from, badge!.to)).toBe('ts')
  })

  it('reveals the ``` on the fence line the cursor sits on', () => {
    const { result } = build(doc, doc.indexOf('```ts') + 1)
    expect(concealedSpans(doc, result).filter((s) => s === '```')).toHaveLength(1)
  })

  it('never reveals in reading mode', () => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf('```ts') + 1),
      extensions: [markdown({ base: markdownLanguage })]
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const result = buildDecorationRanges(state, FEATURES, [{ from: 0, to: state.doc.length }], false)
    expect(concealedSpans(doc, result).filter((s) => s === '```')).toHaveLength(2)
  })

  it('collapses a fence line that has nothing left to show', () => {
    const plain = 'a\n\n```\ncode\n```\n\nb'
    const { state, result } = build(plain, 0)
    expect(lineClasses(state, result, 3)).toContain('cm-zy-code-fence-hidden') // no language badge
    expect(lineClasses(state, result, 5)).toContain('cm-zy-code-fence-hidden')
  })

  it('keeps the badge line at full height', () => {
    const { state, result } = build(doc, 0)
    expect(lineClasses(state, result, 3)).not.toContain('cm-zy-code-fence-hidden')
    expect(lineClasses(state, result, 5)).toContain('cm-zy-code-fence-hidden')
  })
})

describe('loose lists', () => {
  it('treats only the real first item as first, across blank lines', () => {
    const doc = 'intro\n\n- one\n\n- two\n\n- three\n'
    const { state, result } = build(doc, 0)
    expect(lineClasses(state, result, 3)).toContain('cm-zy-li--first')
    // Items 2 and 3 are separated by blank lines but are not new lists.
    expect(lineClasses(state, result, 5)).not.toContain('cm-zy-li--first')
    expect(lineClasses(state, result, 7)).not.toContain('cm-zy-li--first')
  })

  it('still marks the first item of a list that follows a paragraph', () => {
    const doc = 'a paragraph\n- one\n- two\n'
    const { state, result } = build(doc, 0)
    expect(lineClasses(state, result, 2)).toContain('cm-zy-li--first')
    expect(lineClasses(state, result, 3)).not.toContain('cm-zy-li--first')
  })
})
