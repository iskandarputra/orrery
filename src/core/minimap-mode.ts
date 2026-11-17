/**
 * How much of the minimap is showing.
 *
 * Three states out of two switches, because the two are set in different
 * places for different reasons. `minimap` is the preference: whether this
 * editor has one at all, decided once in Settings. `minimapCollapsed` is what
 * the status bar changes, about the file in front of you and changed back a
 * minute later.
 *
 * Collapsed is not hidden. The preview goes, because at a 120px canvas the
 * code is a grey smudge, but where the edits are is the one thing that is
 * still legible at any width. So the change ruler stays and widens, and what
 * is left is a strip of green and red down the edge of the file.
 */
export type MinimapMode =
  /** The scaled preview of the code, 120px of canvas. */
  | 'full'
  /** No preview; the change ruler, widened, standing in for it. */
  | 'bands'
  /** Neither. The ruler goes back to marking the ordinary scrollbar. */
  | 'off'

export interface MinimapSettings {
  minimap: boolean
  minimapCollapsed: boolean
}

/** Off wins over collapsed: there is nothing to collapse. */
export function minimapMode(settings: MinimapSettings): MinimapMode {
  if (!settings.minimap) return 'off'
  return settings.minimapCollapsed ? 'bands' : 'full'
}

/**
 * The ruler, and the scroll track under it, at their ordinary width.
 *
 * 12 leaves a band 8 after a 2px inset each side, and leaves the thumb the
 * full 12 to be grabbed by.
 */
export const RULER_WIDTH = 12

/**
 * And collapsed, where the ruler is all there is.
 *
 * A fifth of the minimap's 120px: it gives 96px back to the text and still
 * leaves a band twice the width of the ordinary one, which is what makes a
 * single changed line worth looking for.
 */
export const COLLAPSED_RULER_WIDTH = 24

export function rulerWidth(mode: MinimapMode): number {
  return mode === 'bands' ? COLLAPSED_RULER_WIDTH : RULER_WIDTH
}
