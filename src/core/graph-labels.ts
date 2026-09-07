/**
 * Whether the graph paints a node's name.
 *
 * This lived inside the canvas draw loop as one long condition, where the only
 * way to check it was to look at pixels. It is a decision over plain values, so
 * it belongs here with a test that can fail.
 */

export interface LabelContext {
  /** The "always show note labels" toggle. */
  always: boolean
  /** Filtered out, or outside the local view. */
  dimmed: boolean
  /** Current zoom, where 1 is unscaled. */
  zoom: number
  /** Links in and out, which is what makes a node worth naming from far off. */
  degree: number
  isHover: boolean
  /** The note open in the focused pane. */
  isActive: boolean
}

export function showsLabel(ctx: LabelContext): boolean {
  // Dimming is how a filter and the local view say "not this one", so it wins
  // over everything below: a label on a node the filter excluded reads as the
  // filter having failed.
  if (ctx.dimmed) return false

  // The node under the pointer and the note that is open name themselves
  // whatever the toggle says. Turning "always show" off is a request for a
  // quiet map, not for one that stays anonymous when somebody goes looking.
  if (ctx.isHover || ctx.isActive) return true

  if (!ctx.always) return false

  // Close enough to read, or well enough connected to be worth the ink.
  return ctx.zoom > 0.6 || ctx.degree >= 2
}
