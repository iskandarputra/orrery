import type { Extension } from '@codemirror/state'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'

/**
 * The vertical lines that show indentation depth.
 *
 * Code is read down its left edge. In a long function the line that tells you
 * which block you are inside is often scrolled off the top, and the guides put
 * that information back on every row.
 *
 * Colours come from the theme's own tokens rather than being fixed, so the
 * guides sit at the same distance from the background in every palette. The
 * active one, marking the block the cursor is in, is deliberately stronger than
 * the rest: it is the one carrying information the others are not.
 */
export function indentGuides(enabled: boolean): Extension {
  if (!enabled) return []
  return indentationMarkers({
    highlightActiveBlock: true,
    // A guide on an empty line inside a block keeps the column unbroken, which
    // is the whole point of a vertical line.
    hideFirstIndent: false,
    markerType: 'fullScope',
    thickness: 1,
    colors: {
      light: 'color-mix(in srgb, var(--or-fg) 14%, transparent)',
      dark: 'color-mix(in srgb, var(--or-fg) 14%, transparent)',
      activeLight: 'color-mix(in srgb, var(--or-fg) 34%, transparent)',
      activeDark: 'color-mix(in srgb, var(--or-fg) 34%, transparent)'
    }
  })
}
