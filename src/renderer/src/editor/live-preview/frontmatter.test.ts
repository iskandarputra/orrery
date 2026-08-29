import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { frontmatterRendering } from './frontmatter'

describe('frontmatterRendering', () => {
  const docWithFrontmatter = `---
id: iskandar-260717-long-idle-uvicorn
title: Long-idle uvicorn dev backend wedges
sev: ⚪
area: platform
status: monitoring
type: defect
owner: iskandar
created: 2026-07-17 #1
---

# Document Title

Body content goes here.
`

  it('renders frontmatter as a properties card box in read mode', () => {
    const state = EditorState.create({
      doc: docWithFrontmatter,
      extensions: [markdown({ base: markdownLanguage }), frontmatterRendering(false)]
    })
    const view = new EditorView({ state })
    const card = view.dom.querySelector('.cm-or-properties-card')
    expect(card).not.toBeNull()

    // The card is editable now, so a key is an input rather than a span, and
    // its text lives in `value`.
    const keys = Array.from(view.dom.querySelectorAll('.cm-or-property-key')).map(
      (el) => (el as HTMLInputElement).value
    )
    expect(keys).toContain('id')
    expect(keys).toContain('status')
    expect(keys).toContain('owner')

    const count = view.dom.querySelector('.cm-or-properties-count')
    expect(count?.textContent).toBe('8')
  })

  it('does not render card when document has no frontmatter', () => {
    const state = EditorState.create({
      doc: '# Just A Normal Document\n\nNo yaml here.',
      extensions: [markdown({ base: markdownLanguage }), frontmatterRendering(false)]
    })
    const view = new EditorView({ state })
    const card = view.dom.querySelector('.cm-or-properties-card')
    expect(card).toBeNull()
  })
})
