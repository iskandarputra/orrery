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
    backgroundColor: 'var(--or-editor-bg)',
    color: 'var(--or-fg)',
    fontSize: 'var(--or-editor-font-size)'
  },
  '.cm-content': {
    ['--or-line-pad' as string]: 'var(--or-editor-line-pad, 2rem)',
    fontFamily: 'var(--or-editor-font-family)',
    lineHeight: 'var(--or-editor-line-height)',
    caretColor: 'var(--or-accent)',
    padding: '2rem 0 50vh',
    maxWidth: 'var(--or-editor-max-width, 46rem)',
    margin: '0 auto'
  },
  /**
   * Published as a variable so line-level features (quotes, code cards, list
   * indents) can compose with this padding instead of fighting it: CodeMirror
   * injects theme rules under a generated class, which outranks a plain
   * `.cm-or-*` selector and would silently win.
   */
  '.cm-line': { padding: '0 var(--or-line-pad)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--or-accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {
      backgroundColor: 'var(--or-selection-bg) !important'
    },
  '.cm-gutters': {
    backgroundColor: 'var(--or-editor-bg)',
    color: 'var(--or-fg-faint)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--or-active-line, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--or-fg-muted)' },
  '.cm-panels': {
    backgroundColor: 'var(--or-panel-bg)',
    color: 'var(--or-fg)',
    borderTop: '1px solid var(--or-border)'
  },
  '.cm-panel.cm-search': { padding: '8px 12px' },
  '.cm-panel input, .cm-panel button': {
    background: 'var(--or-input-bg)',
    color: 'var(--or-fg)',
    border: '1px solid var(--or-border)',
    borderRadius: '4px',
    padding: '3px 8px'
  },
  '.cm-panel button:hover': { background: 'var(--or-hover-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--or-search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--or-search-match-selected)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--or-panel-bg)',
    border: '1px solid var(--or-border)',
    color: 'var(--or-fg)'
  }
})

/**
 * Markdown typography. Because lang-markdown assigns highlight tags per
 * construct, most of the "live" look (bold is bold, headings are big) comes
 * from styling — the live-preview plugin only conceals syntax markers.
 */
// Balanced comfortable heading typography scale
/**
 * Exported so a rendered code card can colour itself with the very same
 * highlighter the editor uses — one token palette, whichever path drew the code.
 */
export const markdownHighlight = HighlightStyle.define([
  {
    tag: tags.heading1,
    fontSize: '1.45em',
    fontWeight: '650',
    letterSpacing: '-0.018em',
    color: 'var(--or-fg)'
  },
  {
    tag: tags.heading2,
    fontSize: '1.28em',
    fontWeight: '600',
    letterSpacing: '-0.012em',
    color: 'var(--or-fg)'
  },
  {
    tag: tags.heading3,
    fontSize: '1.14em',
    fontWeight: '600',
    letterSpacing: '-0.006em',
    color: 'var(--or-fg)'
  },
  { tag: tags.heading4, fontSize: '1.04em', fontWeight: '600', color: 'var(--or-fg)' },
  {
    tag: tags.heading5,
    fontSize: '0.94em',
    fontWeight: '600',
    letterSpacing: '0.03em',
    color: 'var(--or-fg-muted)'
  },
  {
    tag: tags.heading6,
    fontSize: '0.88em',
    fontWeight: '600',
    letterSpacing: '0.04em',
    color: 'var(--or-fg-faint)'
  },
  { tag: tags.strong, fontWeight: '700', color: 'var(--or-fg)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--or-fg)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--or-fg-muted)' },
  { tag: tags.link, color: 'var(--or-accent)' },
  { tag: tags.url, color: 'var(--or-fg-faint)' },
  { tag: tags.labelName, color: 'var(--or-accent)' },
  { tag: tags.monospace, fontFamily: 'var(--or-mono-font)', fontSize: '0.88em' },
  { tag: tags.quote, color: 'var(--or-fg-muted)' },
  { tag: tags.list, color: 'var(--or-fg)' },
  { tag: tags.meta, color: 'var(--or-fg-faint)' },
  { tag: tags.processingInstruction, color: 'var(--or-fg-faint)' },
  { tag: tags.contentSeparator, color: 'var(--or-border)' },
  { tag: tags.escape, color: 'var(--or-fg-faint)' },
  { tag: tags.regexp, color: 'var(--or-code-string)' },
  { tag: tags.tagName, color: 'var(--or-code-keyword)' },
  { tag: tags.attributeName, color: 'var(--or-code-type)' },
  { tag: tags.attributeValue, color: 'var(--or-code-string)' },
  { tag: tags.bracket, color: 'var(--or-fg-faint)' },
  { tag: tags.punctuation, color: 'var(--or-fg-muted)' },
  { tag: tags.atom, color: 'var(--or-code-number)' },
  { tag: tags.bool, color: 'var(--or-code-number)' },
  { tag: tags.null, color: 'var(--or-code-number)' },
  { tag: tags.inserted, color: 'var(--or-code-property)' },
  { tag: tags.deleted, color: 'var(--or-code-keyword)', textDecoration: 'line-through' },
  { tag: tags.changed, color: 'var(--or-code-type)' },
  // Code-block token colors (via language-data nested parsers).
  { tag: tags.keyword, color: 'var(--or-code-keyword)' },
  { tag: tags.string, color: 'var(--or-code-string)' },
  { tag: tags.comment, color: 'var(--or-code-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--or-code-number)' },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName)
    ],
    color: 'var(--or-code-function)'
  },
  {
    tag: [tags.typeName, tags.className, tags.constant(tags.variableName)],
    color: 'var(--or-code-type)'
  },
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName), tags.variableName],
    color: 'var(--or-code-property)'
  },
  { tag: tags.operator, color: 'var(--or-fg-muted)' }
])

export function orreryEditorTheme(): Extension {
  return [editorChrome, syntaxHighlighting(markdownHighlight)]
}
