/**
 * How wide each pane is.
 *
 * Fractions rather than pixels, one per pane, adding up to 1. A window that is
 * resized, a sidebar that opens, a pane that closes: all of those change the
 * space available, and none of them should change the proportions somebody
 * chose. Pixels would need recomputing on every one of them; fractions need
 * nothing.
 *
 * The rules that earn this module its tests are the edges. Dragging a divider
 * past the pane beside it must stop rather than invert. Closing a pane has to
 * hand its width to the others without leaving the total short. And a stored
 * list from a layout with three panes has to survive being restored into two.
 */

/** Nobody can read a column narrower than this share of the editor. */
export const MIN_PANE = 0.12

export function equalSizes(count: number): number[] {
  const panes = Math.max(1, Math.trunc(count) || 1)
  return Array.from({ length: panes }, () => 1 / panes)
}

/**
 * Make a stored list fit the panes there actually are.
 *
 * Fewer panes: the survivors keep their proportions relative to each other.
 * More: the new ones take an equal share and the rest shrink to make room. A
 * list that is nonsense, empty, or full of zeroes falls back to equal columns,
 * because a pane of width zero is a pane nobody can find again.
 */
export function fitSizes(sizes: readonly number[], count: number): number[] {
  const panes = Math.max(1, Math.trunc(count) || 1)
  const usable = sizes.filter((size) => Number.isFinite(size) && size > 0)

  if (usable.length === 0) return equalSizes(panes)
  if (usable.length === panes) return normalise(usable)

  if (usable.length > panes) return normalise(usable.slice(0, panes))

  // Growing: the new panes get an equal share of the whole, the old ones keep
  // their shape inside what is left.
  const added = panes - usable.length
  const share = 1 / panes
  const remaining = 1 - added * share
  const scaled = normalise(usable).map((size) => size * remaining)
  return normalise([...scaled, ...Array.from({ length: added }, () => share)])
}

/**
 * Move one divider.
 *
 * `divider` is the boundary between pane `divider` and the one after it, and
 * `delta` is how far it moved as a fraction of the whole. Only those two panes
 * change: dragging a boundary in a three-pane layout must not shuffle the third.
 */
export function resizePanes(
  sizes: readonly number[],
  divider: number,
  delta: number,
  min: number = MIN_PANE
): number[] {
  const next = [...sizes]
  const left = next[divider]
  const right = next[divider + 1]
  if (left === undefined || right === undefined || !Number.isFinite(delta)) return normalise(next)

  // Clamped to what the pair can give: past this the divider stops rather than
  // pushing a pane to nothing or swapping the two over.
  const room = Math.min(delta, right - min)
  const moved = Math.max(room, min - left)

  next[divider] = left + moved
  next[divider + 1] = right - moved
  return normalise(next)
}

/**
 * The `grid-template-columns` value for these sizes.
 *
 * The dividers are grid tracks of their own, interleaved between the panes,
 * because a divider drawn inside a pane would be a border that moves the text
 * it sits beside. `divider` is any CSS length; an empty one leaves them out.
 */
export function toColumns(sizes: readonly number[], divider = ''): string {
  const columns = normalise(sizes).map((size) => `minmax(0, ${size.toFixed(4)}fr)`)
  return divider ? columns.join(` ${divider} `) : columns.join(' ')
}

/** Whatever it was given, as fractions of 1. */
function normalise(sizes: readonly number[]): number[] {
  const total = sizes.reduce(
    (sum, size) => sum + (Number.isFinite(size) ? Math.max(size, 0) : 0),
    0
  )
  if (total <= 0) return equalSizes(sizes.length)
  return sizes.map((size) => (Number.isFinite(size) ? Math.max(size, 0) : 0) / total)
}
