import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { showMinimap } from '@replit/codemirror-minimap'

/**
 * The scaled-down preview of the whole file beside the scrollbar.
 *
 * Painted to a canvas, but coloured by reading the editor's own highlighting —
 * so all seven palettes come out right without any of them being described a
 * second time here.
 *
 * `blocks` rather than `characters`: at this scale glyphs are illegible anyway,
 * and drawing them costs a full text layout of the document on every change.
 * The shape of the code — indentation, line length, where the blank lines fall —
 * is the whole of what a minimap is read for.
 */
export interface MinimapOptions {
  /**
   * A colour per 1-based line, drawn as a strip down the edge of the preview.
   * Used by the diff to show where the changes are, so the whole file's shape
   * of edits is visible without scrolling through it.
   */
  gutter?: Record<number, string>
}

export function minimap(enabled: boolean, options: MinimapOptions = {}): Extension {
  if (!enabled) return []
  const gutter = options.gutter
  return [
    showMinimap.compute([], () => ({
      create: () => ({ dom: document.createElement('div') }),
      displayText: 'blocks',
      // Always, not on hover: the point is to see where you are without first
      // having to go and ask.
      showOverlay: 'always',
      // An empty record would draw an empty strip and waste the width.
      ...(gutter && Object.keys(gutter).length > 0 ? { gutters: [gutter] } : {})
    })),
    minimapTheme
  ]
}

/**
 * The package ships no colours of its own, so the panel would otherwise sit on
 * whatever is behind it with an overlay that cannot be seen. Everything here is
 * a token, so a theme change carries the minimap with it.
 */
const minimapTheme = EditorView.theme({
  // The column itself. Without a background the blocks float over the page and
  // the strip stops wherever the file does, leaving a bright gap below it.
  '& .cm-minimap-gutter': {
    background: 'var(--or-editor-bg)',
    borderLeft: '1px solid var(--or-border)',
    height: '100%'
  },
  // The package's default is a fixed grey that disappears into a dark theme and
  // muddies a light one; the foreground token is legible against either.
  '& .cm-minimap-overlay-container .cm-minimap-overlay': {
    background: 'var(--or-fg)',
    opacity: '0.1'
  },
  '& .cm-minimap-overlay-container .cm-minimap-overlay:hover': {
    opacity: '0.16'
  },
  '& .cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay': {
    opacity: '0.22'
  }
})
