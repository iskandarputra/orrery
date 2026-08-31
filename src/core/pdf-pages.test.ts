import { describe, expect, it } from 'vitest'
import {
  appendPages,
  extractPages,
  initialPlan,
  isUnchanged,
  movePages,
  removePages,
  rotatePages
} from './pdf-pages'

describe('initialPlan', () => {
  it('keeps every page as it was', () => {
    expect(initialPlan(3)).toEqual({ order: [0, 1, 2], rotate: [0, 0, 0] })
  })

  it('copes with a document of no pages rather than producing nonsense', () => {
    expect(initialPlan(0)).toEqual({ order: [], rotate: [] })
  })
})

describe('removePages', () => {
  it('takes out the pages named, by where they sit now', () => {
    expect(removePages(initialPlan(4), [1])).toEqual({ order: [0, 2, 3], rotate: [0, 0, 0] })
  })

  it('takes the rotation out with the page it belongs to', () => {
    const turned = rotatePages(initialPlan(3), [1], 90)
    expect(removePages(turned, [0]).rotate).toEqual([90, 0])
  })

  it('refuses to remove every page', () => {
    // A PDF with no pages is not an empty document, it is a broken one, and
    // the reader that has to show it afterwards has nowhere to go.
    const plan = initialPlan(2)
    expect(removePages(plan, [0, 1])).toBe(plan)
  })

  it('ignores positions that are not in the plan', () => {
    expect(removePages(initialPlan(2), [5]).order).toEqual([0, 1])
  })
})

describe('movePages', () => {
  it('moves a page to the front', () => {
    expect(movePages(initialPlan(3), [2], 0).order).toEqual([2, 0, 1])
  })

  it('moves a page to the end', () => {
    expect(movePages(initialPlan(3), [0], 3).order).toEqual([1, 2, 0])
  })

  it('reads the target as a gap between pages, not as a page', () => {
    // Dropping "before page 2" has to mean the same thing whether the dragged
    // page came from in front of that gap or behind it.
    expect(movePages(initialPlan(4), [0], 2).order).toEqual([1, 0, 2, 3])
    expect(movePages(initialPlan(4), [3], 2).order).toEqual([0, 1, 3, 2])
  })

  it('keeps a block of pages together and in its own order', () => {
    expect(movePages(initialPlan(5), [1, 2], 5).order).toEqual([0, 3, 4, 1, 2])
  })

  it("carries each page's rotation with it", () => {
    const turned = rotatePages(initialPlan(3), [2], 180)
    expect(movePages(turned, [2], 0)).toEqual({ order: [2, 0, 1], rotate: [180, 0, 0] })
  })

  it('does nothing when there is nowhere to move to', () => {
    const plan = initialPlan(2)
    expect(movePages(plan, [0, 1], 0)).toBe(plan)
  })
})

describe('rotatePages', () => {
  it('turns a quarter clockwise', () => {
    expect(rotatePages(initialPlan(2), [0], 90).rotate).toEqual([90, 0])
  })

  it('adds to the turn a page already has', () => {
    const once = rotatePages(initialPlan(1), [0], 90)
    expect(rotatePages(once, [0], 90).rotate).toEqual([180])
  })

  it('comes back round rather than counting past a full turn', () => {
    const thrice = rotatePages(rotatePages(rotatePages(initialPlan(1), [0], 90), [0], 90), [0], 180)
    expect(thrice.rotate).toEqual([0])
  })

  it('turns the other way for a negative angle', () => {
    // Never a negative rotation: PDF has no such thing, and a viewer handed one
    // is entitled to ignore it.
    expect(rotatePages(initialPlan(1), [0], -90).rotate).toEqual([270])
  })
})

describe('extractPages', () => {
  it('keeps only the pages named, in document order', () => {
    expect(extractPages(initialPlan(5), [3, 1]).order).toEqual([1, 3])
  })

  it('takes their rotations with them', () => {
    const turned = rotatePages(initialPlan(3), [2], 90)
    expect(extractPages(turned, [2]).rotate).toEqual([90])
  })
})

describe('appendPages', () => {
  it('numbers the second document from where the first one stops', () => {
    // One plan describes a merge: the engine is handed both files and told
    // which pages to take from each.
    expect(appendPages(initialPlan(2), 3, 2).order).toEqual([0, 1, 2, 3, 4])
  })
})

describe('isUnchanged', () => {
  it('knows a plan that would do nothing', () => {
    expect(isUnchanged(initialPlan(3), 3)).toBe(true)
  })

  it('knows a reordering, a removal and a rotation are all changes', () => {
    expect(isUnchanged(movePages(initialPlan(3), [0], 3), 3)).toBe(false)
    expect(isUnchanged(removePages(initialPlan(3), [0]), 3)).toBe(false)
    expect(isUnchanged(rotatePages(initialPlan(3), [0], 90), 3)).toBe(false)
  })
})
