import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blockquote } from './features/blockquote'
import { emphasis } from './features/emphasis'
import { headings } from './features/headings'
import { hr } from './features/hr'
import { inlineCode } from './features/inline-code'
import { links } from './features/links'
import { lists } from './features/lists'
import { buildDecorationRanges, type BuiltDecorations } from './plugin'
import { parseFully } from './parse-fully'

const ALL_FEATURES = [
  headings,
  emphasis,
  inlineCode,
  links({ renderImages: false }),
  lists({ fancyBullets: true, interactiveCheckboxes: true }),
  blockquote,
  hr
]

function build(doc: string, cursor = 0): { state: EditorState; result: BuiltDecorations } {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })]
  })
  parseFully(state)
  const result = buildDecorationRanges(state, ALL_FEATURES, [{ from: 0, to: state.doc.length }])
  return { state, result }
}

function concealedSpans(doc: string, result: BuiltDecorations): string[] {
  return result.conceals.map((r) => doc.slice(r.from, r.to))
}

describe('live preview decorations', () => {
  it('conceals heading marks when the cursor is on another line', () => {
    const doc = '# Title\n\ntext'
    const { result } = build(doc, doc.length)
    expect(concealedSpans(doc, result)).toContain('# ')
  })

  it('reveals heading marks when the cursor is on the heading line', () => {
    const doc = '# Title\n\ntext'
    const { result } = build(doc, 3)
    expect(concealedSpans(doc, result)).not.toContain('# ')
  })

  it('conceals bold markers when cursor is outside the construct', () => {
    const doc = 'some **bold** text'
    const { result } = build(doc, 0)
    const spans = concealedSpans(doc, result)
    expect(spans.filter((s) => s === '**')).toHaveLength(2)
  })

  it('reveals bold markers when the cursor is inside', () => {
    const doc = 'some **bold** text'
    const { result } = build(doc, 8) // inside "bold"
    expect(concealedSpans(doc, result)).not.toContain('**')
  })

  it('conceals link syntax and keeps the label with its url attached', () => {
    const doc = 'see [docs](https://example.com) here'
    const { result } = build(doc, 0)
    const spans = concealedSpans(doc, result)
    expect(spans).toContain('[')
    expect(spans).toContain('](https://example.com)')
    const linkMark = result.all.find((r) => {
      const spec = (r.value as { spec?: { attributes?: Record<string, string> } }).spec
      return spec?.attributes?.['data-url'] === 'https://example.com'
    })
    expect(linkMark).toBeDefined()
    expect(doc.slice(linkMark!.from, linkMark!.to)).toBe('docs')
  })

  it('replaces task markers with checkbox widgets when line is inactive', () => {
    const doc = '- [x] done\n\nelsewhere'
    const { result } = build(doc, doc.length)
    const widgets = result.all.filter(
      (r) => (r.value as { spec?: { widget?: unknown } }).spec?.widget !== undefined
    )
    expect(widgets.length).toBeGreaterThan(0)
  })

  it('conceals blockquote marks on inactive lines only', () => {
    const doc = '> quoted line\n\nplain'
    const inactive = build(doc, doc.length)
    expect(concealedSpans(doc, inactive.result)).toContain('> ')
    const active = build(doc, 4)
    expect(concealedSpans(doc, active.result)).not.toContain('> ')
  })

  it('replaces an hr line with a widget when inactive', () => {
    const doc = 'a\n\n---\n\nb'
    const { result } = build(doc, 0)
    const hrWidget = result.all.find(
      (r) =>
        doc.slice(r.from, r.to) === '---' &&
        (r.value as { spec?: { widget?: unknown } }).spec?.widget
    )
    expect(hrWidget).toBeDefined()
  })
})
