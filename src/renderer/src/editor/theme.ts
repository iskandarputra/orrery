import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * Editor chrome reads the same CSS custom properties as the app shell
 * (styles/tokens.css), so one token set drives both and themes stay in sync.
 */
const editorChrome = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--zy-editor-bg)',
    color: 'var(--zy-fg)',
    fontSize: 'var(--zy-editor-font-size)'
  },
  '.cm-content': {
    fontFamily: 'var(--zy-editor-font-family)',
    lineHeight: 'var(--zy-editor-line-height)',
    caretColor: 'var(--zy-accent)',
    padding: '2rem 0 50vh',
    maxWidth: 'var(--zy-editor-max-width, 46rem)',
    margin: '0 auto'
  },
  '.cm-line': { padding: '0 2rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--zy-accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {
      backgroundColor: 'var(--zy-selection-bg) !important'
    },
  '.cm-gutters': {
    backgroundColor: 'var(--zy-editor-bg)',
    color: 'var(--zy-fg-faint)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--zy-active-line, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--zy-fg-muted)' },
  '.cm-panels': {
    backgroundColor: 'var(--zy-panel-bg)',
    color: 'var(--zy-fg)',
    borderTop: '1px solid var(--zy-border)'
  },
  '.cm-panel.cm-search': { padding: '8px 12px' },
  '.cm-panel input, .cm-panel button': {
    background: 'var(--zy-input-bg)',
    color: 'var(--zy-fg)',
    border: '1px solid var(--zy-border)',
    borderRadius: '4px',
    padding: '3px 8px'
  },
  '.cm-panel button:hover': { background: 'var(--zy-hover-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--zy-search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--zy-search-match-selected)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--zy-panel-bg)',
    border: '1px solid var(--zy-border)',
    color: 'var(--zy-fg)'
  }
})

/**
 * Markdown typography. Because lang-markdown assigns highlight tags per
 * construct, most of the "live" look (bold is bold, headings are big) comes
 * from styling — the live-preview plugin only conceals syntax markers.
 */
// GitHub's heading scale: 2 / 1.5 / 1.25 / 1 / .875 / .85em, weight 600.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '2em', fontWeight: '600', letterSpacing: '-0.02em' },
  { tag: tags.heading2, fontSize: '1.5em', fontWeight: '600', letterSpacing: '-0.01em' },
  { tag: tags.heading3, fontSize: '1.25em', fontWeight: '600' },
  { tag: tags.heading4, fontSize: '1em', fontWeight: '600' },
  { tag: tags.heading5, fontSize: '0.875em', fontWeight: '600' },
  { tag: tags.heading6, fontSize: '0.85em', fontWeight: '600', color: 'var(--zy-fg-muted)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--zy-fg-muted)' },
  { tag: tags.link, color: 'var(--zy-accent)' },
  { tag: tags.url, color: 'var(--zy-fg-faint)' },
  { tag: tags.monospace, fontFamily: 'var(--zy-mono-font)', fontSize: '0.9em' },
  { tag: tags.quote, color: 'var(--zy-fg-muted)' },
  { tag: tags.list, color: 'var(--zy-fg)' },
  { tag: tags.meta, color: 'var(--zy-fg-faint)' },
  { tag: tags.processingInstruction, color: 'var(--zy-fg-faint)' },
  { tag: tags.contentSeparator, color: 'var(--zy-fg-faint)' },
  // Code-block token colors (via language-data nested parsers).
  { tag: tags.keyword, color: 'var(--zy-code-keyword)' },
  { tag: tags.string, color: 'var(--zy-code-string)' },
  { tag: tags.comment, color: 'var(--zy-code-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--zy-code-number)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--zy-code-function)'
  },
  { tag: tags.typeName, color: 'var(--zy-code-type)' },
  { tag: tags.propertyName, color: 'var(--zy-code-property)' },
  { tag: tags.operator, color: 'var(--zy-fg-muted)' }
])

export function zymdEditorTheme(): Extension {
  return [editorChrome, syntaxHighlighting(markdownHighlight)]
}
