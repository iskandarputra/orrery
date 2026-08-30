import { describe, expect, it } from 'vitest'
import { equalSizes, fitSizes, MIN_PANE, resizePanes, toColumns } from './pane-sizes'

const sum = (sizes: number[]): number => sizes.reduce((total, size) => total + size, 0)

describe('equalSizes', () => {
  it('divides the width evenly', () => {
    expect(equalSizes(2)).toEqual([0.5, 0.5])
    expect(sum(equalSizes(3))).toBeCloseTo(1)
  })

  it('always has at least one pane', () => {
    expect(equalSizes(0)).toEqual([1])
    expect(equalSizes(-3)).toEqual([1])
  })
})

describe('fitSizes', () => {
  it('leaves a list that already fits alone', () => {
    expect(fitSizes([0.7, 0.3], 2)).toEqual([0.7, 0.3])
  })

  it('keeps the survivors in proportion when a pane closes', () => {
    // 60:20 stays 3:1 rather than reverting to equal columns.
    const after = fitSizes([0.6, 0.2, 0.2], 2)
    expect(sum(after)).toBeCloseTo(1)
    expect(after[0]! / after[1]!).toBeCloseTo(3)
  })

  it('gives a new pane an equal share and shrinks the rest to fit', () => {
    const after = fitSizes([0.5, 0.5], 3)
    expect(sum(after)).toBeCloseTo(1)
    expect(after[2]).toBeCloseTo(1 / 3)
    expect(after[0]).toBeCloseTo(after[1]!)
  })

  it('falls back to equal columns for nonsense', () => {
    // A pane of width zero is a pane nobody can find again.
    expect(fitSizes([], 2)).toEqual([0.5, 0.5])
    expect(fitSizes([0, 0], 2)).toEqual([0.5, 0.5])
    expect(fitSizes([Number.NaN, Number.POSITIVE_INFINITY], 2)).toEqual([0.5, 0.5])
  })

  it('normalises a list that does not add up', () => {
    expect(sum(fitSizes([2, 2], 2))).toBeCloseTo(1)
  })
})

describe('resizePanes', () => {
  it('moves width from one pane to its neighbour', () => {
    const after = resizePanes([0.5, 0.5], 0, 0.1)
    expect(after[0]).toBeCloseTo(0.6)
    expect(after[1]).toBeCloseTo(0.4)
  })

  it('leaves every other pane alone', () => {
    // Dragging one boundary in a three-pane layout must not shuffle the third.
    const after = resizePanes([0.4, 0.3, 0.3], 0, 0.1)
    expect(after[2]).toBeCloseTo(0.3)
    expect(sum(after)).toBeCloseTo(1)
  })

  it('stops rather than pushing a pane to nothing', () => {
    const after = resizePanes([0.5, 0.5], 0, 0.9)
    expect(after[1]).toBeCloseTo(MIN_PANE)
    expect(after[0]).toBeCloseTo(1 - MIN_PANE)
  })

  it('stops in the other direction too', () => {
    const after = resizePanes([0.5, 0.5], 0, -0.9)
    expect(after[0]).toBeCloseTo(MIN_PANE)
  })

  it('never swaps the two panes over', () => {
    for (const delta of [-5, -1, 1, 5]) {
      const after = resizePanes([0.3, 0.7], 0, delta)
      expect(after[0]).toBeGreaterThanOrEqual(MIN_PANE - 0.001)
      expect(after[1]).toBeGreaterThanOrEqual(MIN_PANE - 0.001)
      expect(sum(after)).toBeCloseTo(1)
    }
  })

  it('ignores a divider that is not between two panes', () => {
    expect(resizePanes([0.5, 0.5], 5, 0.1)).toEqual([0.5, 0.5])
    expect(resizePanes([1], 0, 0.1)).toEqual([1])
  })

  it('ignores a delta that is not a number', () => {
    expect(resizePanes([0.5, 0.5], 0, Number.NaN)).toEqual([0.5, 0.5])
  })
})

describe('toColumns', () => {
  it('writes the grid template a browser can use', () => {
    expect(toColumns([0.5, 0.5])).toBe('minmax(0, 0.5000fr) minmax(0, 0.5000fr)')
  })

  it('normalises on the way out, so a stale list still renders', () => {
    expect(toColumns([2, 2])).toBe('minmax(0, 0.5000fr) minmax(0, 0.5000fr)')
  })

  it('leaves a track for each divider when asked for one', () => {
    // A divider drawn inside a pane would be a border that moves the text it
    // sits beside; it gets a column of its own.
    expect(toColumns([0.5, 0.5], '5px')).toBe('minmax(0, 0.5000fr) 5px minmax(0, 0.5000fr)')
    expect(toColumns([1], '5px')).toBe('minmax(0, 1.0000fr)')
  })
})
