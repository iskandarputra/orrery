/**
 * Rearranging a document, as a plan rather than as a sequence of edits.
 *
 * Every page operation — delete, reorder, rotate, extract, split — comes out as
 * the same two lists: which of the original pages to keep and in what order,
 * and how each of them is turned. That is exactly what the writing engine needs
 * (it builds a new document by importing pages from the old one), and it means
 * a hundred fiddly operations are one description that can be checked, undone
 * and applied in a single pass.
 *
 * Positions in these functions are positions in the *plan* — what somebody sees
 * in the page rail — not indices into the original file, because that is what a
 * person is pointing at when they say "delete this one".
 *
 * Nothing here mutates: a plan is compared against the last one to know whether
 * the document has unsaved changes.
 */

export interface PagePlan {
  /** 0-based indices into the source document, in output order. */
  order: number[]
  /** Absolute rotation of each output page, in degrees: 0, 90, 180 or 270. */
  rotate: number[]
}

/** The plan that changes nothing: every page, in order, as it was. */
export function initialPlan(count: number): PagePlan {
  const pages = Math.max(0, Math.trunc(count) || 0)
  return {
    order: Array.from({ length: pages }, (_, i) => i),
    rotate: Array.from({ length: pages }, () => 0)
  }
}

/** Whether a plan would leave the document exactly as it is. */
export function isUnchanged(plan: PagePlan, count: number): boolean {
  const original = initialPlan(count)
  return (
    plan.order.length === original.order.length &&
    plan.order.every((page, i) => page === original.order[i]) &&
    plan.rotate.every((angle) => angle === 0)
  )
}

/** Positions that are actually in the plan, deduplicated and in order. */
function valid(plan: PagePlan, positions: readonly number[]): number[] {
  return [...new Set(positions)]
    .filter((position) => position >= 0 && position < plan.order.length)
    .sort((a, b) => a - b)
}

/**
 * Remove pages.
 *
 * Removing every page is refused rather than obeyed: a PDF with no pages is not
 * an empty document, it is a broken one, and nothing downstream — including the
 * reader that would have to show it — has anywhere to go from there.
 */
export function removePages(plan: PagePlan, positions: readonly number[]): PagePlan {
  const going = new Set(valid(plan, positions))
  if (going.size === 0 || going.size >= plan.order.length) return plan
  return {
    order: plan.order.filter((_, i) => !going.has(i)),
    rotate: plan.rotate.filter((_, i) => !going.has(i))
  }
}

/**
 * Move pages so they sit before the page currently at `before`.
 *
 * `before` is a gap, not a page: it runs from 0 (in front of everything) to the
 * page count (after everything), which is how a drop between two thumbnails has
 * to be read. The pages keep their own order among themselves, so dragging a
 * block of three keeps the block.
 */
export function movePages(plan: PagePlan, positions: readonly number[], before: number): PagePlan {
  const moving = valid(plan, positions)
  if (moving.length === 0 || moving.length === plan.order.length) return plan

  const gap = Math.min(Math.max(0, Math.trunc(before) || 0), plan.order.length)
  // How many of the moved pages were before the gap: the gap has to slide back
  // by that many, since those pages are being lifted out from in front of it.
  const lifted = moving.filter((position) => position < gap).length
  const target = gap - lifted

  const keptOrder = plan.order.filter((_, i) => !moving.includes(i))
  const keptRotate = plan.rotate.filter((_, i) => !moving.includes(i))

  return {
    order: [
      ...keptOrder.slice(0, target),
      ...moving.map((i) => plan.order[i]!),
      ...keptOrder.slice(target)
    ],
    rotate: [
      ...keptRotate.slice(0, target),
      ...moving.map((i) => plan.rotate[i]!),
      ...keptRotate.slice(target)
    ]
  }
}

/** Turn pages by a quarter turn or several, clockwise for a positive angle. */
export function rotatePages(plan: PagePlan, positions: readonly number[], by: number): PagePlan {
  const turning = new Set(valid(plan, positions))
  if (turning.size === 0) return plan
  const quarters = Math.round(by / 90) * 90
  return {
    order: [...plan.order],
    rotate: plan.rotate.map((angle, i) =>
      turning.has(i) ? (((angle + quarters) % 360) + 360) % 360 : angle
    )
  }
}

/** A plan for just these pages — what "extract to a new file" needs. */
export function extractPages(plan: PagePlan, positions: readonly number[]): PagePlan {
  const keeping = valid(plan, positions)
  return {
    order: keeping.map((i) => plan.order[i]!),
    rotate: keeping.map((i) => plan.rotate[i]!)
  }
}

/**
 * A plan that appends another document's pages after this one's.
 *
 * The second document's pages are numbered from where the first one's stop, so
 * one plan can describe a merge: the engine is handed both files and told to
 * take pages from each in this order.
 */
export function appendPages(plan: PagePlan, count: number, offset: number): PagePlan {
  const pages = Math.max(0, Math.trunc(count) || 0)
  return {
    order: [...plan.order, ...Array.from({ length: pages }, (_, i) => offset + i)],
    rotate: [...plan.rotate, ...Array.from({ length: pages }, () => 0)]
  }
}
