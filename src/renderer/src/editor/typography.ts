import type { Settings } from '@shared/settings'
import { lineWidthCss } from './line-width'

/**
 * How a text document is set, as the variables the editor theme reads.
 *
 * There is more than one surface showing text in a pane — the editor, and the
 * two files side by side in a diff — and they all render through
 * `orreryEditorTheme`, which takes its size, face and measure from these. They
 * were declared on the editor's own element, so anything that was not the
 * editor fell back to the defaults in `tokens.css` and stayed there: a diff was
 * set at a fixed 16px in the *prose* face, whatever the settings said, and page
 * zoom moved the number without moving anything on screen.
 *
 * So the answer lives here instead of in a component, and a surface that shows
 * text says which kind of document it is showing rather than working out five
 * variables of its own.
 */

/** Which of the two ways a document is read. */
export type DocumentSetting = 'prose' | 'code'

/**
 * Prose reads in a proportional face down a measured column; code does not.
 *
 * A code file set in the prose font loses the column alignment indentation
 * depends on, and picks up the ligatures that turn `=>` into a glyph the file
 * does not contain. It is also read down its left edge against that
 * indentation, so it takes the full width of the pane and sits just clear of
 * the gutter rather than being centred in a 46rem measure.
 *
 * An explicit font setting still wins for either kind.
 */
export function documentTypography(
  editor: Settings['editor'],
  setting: DocumentSetting
): Record<string, string> {
  const code = setting === 'code'
  return {
    '--or-editor-font-size': `${editor.fontSize}px`,
    '--or-editor-line-height': String(editor.lineHeight),
    '--or-editor-font-family':
      editor.fontFamily || (code ? 'var(--or-mono-font)' : 'var(--or-prose-font)'),
    '--or-editor-max-width': code ? 'none' : lineWidthCss(editor),
    '--or-editor-line-pad': code ? '0.75rem' : '2rem'
  }
}
