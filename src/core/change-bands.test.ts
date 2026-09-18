import { describe, expect, it } from 'vitest'
import { mergeRuns, rulerBands } from './change-bands'

describe('mergeRuns', () => {
  it('joins consecutive lines of one colour into a single run', () => {
    expect(mergeRuns({ 3: 'green', 4: 'green', 5: 'green' })).toEqual([
      { from: 3, to: 5, colour: 'green' }
    ])
  })

  it('breaks a run at a gap', () => {
    expect(mergeRuns({ 1: 'green', 2: 'green', 9: 'green' })).toEqual([
      { from: 1, to: 2, colour: 'green' },
      { from: 9, to: 9, colour: 'green' }
    ])
  })

  it('breaks a run where the colour changes, adjacent or not', () => {
    expect(mergeRuns({ 1: 'green', 2: 'red' })).toEqual([
      { from: 1, to: 1, colour: 'green' },
      { from: 2, to: 2, colour: 'red' }
    ])
  })

  it('sorts numerically, not the way object keys come back', () => {
    expect(mergeRuns({ 10: 'green', 9: 'green' })).toEqual([{ from: 9, to: 10, colour: 'green' }])
  })

  it('drops line numbers a document cannot have', () => {
    expect(mergeRuns({ 0: 'green', '-2': 'green', 1.5: 'green' })).toEqual([])
  })
})

describe('rulerBands', () => {
  it('places a run in proportion to where it falls in the file', () => {
    // Lines 51-100 of 100, on a 200px track: the lower half.
    const [band] = rulerBands([{ from: 51, to: 100, colour: 'red' }], 100, 200, 3)
    expect(band).toEqual({ top: 100, height: 100, colour: 'red' })
  })

  it('grows a band too small to see up to the floor', () => {
    // One line of 3000 on a 300px track is a tenth of a pixel.
    const [band] = rulerBands([{ from: 1, to: 1, colour: 'green' }], 3000, 300, 3)
    expect(band!.height).toBe(3)
  })

  it('leaves a band that already clears the floor alone', () => {
    const [band] = rulerBands([{ from: 1, to: 100, colour: 'green' }], 300, 300, 3)
    expect(band!.height).toBe(100)
  })

  it('pushes a grown band back inside the track rather than off the bottom', () => {
    // The last line of the file: proportionally at 299.9 of 300, which with a
    // 3px floor would paint 2.9px of it below the track.
    const [band] = rulerBands([{ from: 3000, to: 3000, colour: 'red' }], 3000, 300, 3)
    expect(band!.top).toBe(297)
    expect(band!.top + band!.height).toBe(300)
  })

  it('never starts a band above the track', () => {
    // A floor taller than the whole track, which would otherwise go negative.
    const [band] = rulerBands([{ from: 1, to: 1, colour: 'red' }], 10, 4, 20)
    expect(band).toEqual({ top: 0, height: 4, colour: 'red' })
  })

  it('drops a run past the end of the document', () => {
    // Not clamped to the last line: a stale diff would then claim a change at
    // the end of a file that has none.
    expect(rulerBands([{ from: 40, to: 42, colour: 'red' }], 30, 300, 3)).toEqual([])
  })

  it('clips a run that runs off the end', () => {
    const [band] = rulerBands([{ from: 25, to: 42, colour: 'red' }], 30, 300, 3)
    expect(band).toEqual({ top: 240, height: 60, colour: 'red' })
  })

  it('draws nothing before the track has been measured', () => {
    expect(rulerBands([{ from: 1, to: 1, colour: 'red' }], 100, 0, 3)).toEqual([])
    expect(rulerBands([{ from: 1, to: 1, colour: 'red' }], 0, 300, 3)).toEqual([])
  })
})
