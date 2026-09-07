import { describe, expect, it } from 'vitest'
import { step, SETTLED, type Body, type Forces, type Link } from './graph-sim'

const forces: Forces = { repel: 1, linkForce: 1, linkDistance: 1, center: 1 }

const bodies = (...points: [number, number][]): Body[] =>
  points.map(([x, y]) => ({ x, y, vx: 0, vy: 0 }))

describe('step', () => {
  it('pushes two bodies in the same place apart', () => {
    // The degenerate case the `Math.max(64, d2)` floor exists for: without it
    // the force is infinite and both bodies leave for NaN.
    const b = bodies([0, 0], [0, 0])
    step(b, [], forces)
    expect(Number.isFinite(b[0]!.x)).toBe(true)
    expect(Number.isFinite(b[1]!.x)).toBe(true)
  })

  it('pulls two linked bodies toward each other when they are too far apart', () => {
    const b = bodies([-400, 0], [400, 0])
    const links: Link[] = [{ a: 0, b: 1 }]
    step(b, links, forces)
    expect(b[0]!.x).toBeGreaterThan(-400)
    expect(b[1]!.x).toBeLessThan(400)
  })

  it('pulls a lone body toward the centre', () => {
    const b = bodies([500, 0])
    step(b, [], forces)
    expect(b[0]!.x).toBeLessThan(500)
  })

  it('leaves a pinned body exactly where it is', () => {
    // Dragging a node pins it. If the step moved it, the node would fight the
    // pointer, which is what `if (n === drag) continue` prevents today.
    const b = bodies([100, 100], [120, 90])
    step(b, [], forces, 0)
    expect(b[0]!.x).toBe(100)
    expect(b[0]!.y).toBe(100)
    expect(b[1]!.x).not.toBe(120)
  })

  it('gives the same result for the same input every time', () => {
    const one = bodies([10, 20], [-30, 5], [7, -80])
    const two = bodies([10, 20], [-30, 5], [7, -80])
    for (let i = 0; i < 50; i++) {
      step(one, [{ a: 0, b: 1 }], forces)
      step(two, [{ a: 0, b: 1 }], forces)
    }
    expect(two.map((n) => n.x)).toEqual(one.map((n) => n.x))
  })

  it('reports an energy that falls as the layout settles', () => {
    // This is what a sleep threshold will read, so it has to actually decay.
    const b = bodies([200, 0], [-200, 0], [0, 200])
    const first = step(b, [{ a: 0, b: 1 }], forces)
    let last = first
    for (let i = 0; i < 400; i++) last = step(b, [{ a: 0, b: 1 }], forces)
    expect(last).toBeLessThan(first)
  })

  it('keeps a body with no links and no neighbours finite', () => {
    const b = bodies([0, 0])
    for (let i = 0; i < 1000; i++) step(b, [], forces)
    expect(Number.isFinite(b[0]!.x)).toBe(true)
    expect(Math.abs(b[0]!.x)).toBeLessThan(1000)
  })
})

describe('settling', () => {
  it('falls below the settled threshold and stays there', () => {
    // Without a threshold there is nothing for the loop to test, and the graph
    // asks for frames forever. The number matters: too high and the layout
    // freezes mid-arrangement, too low and it never sleeps.
    const b = bodies([120, 0], [-120, 0], [0, 140], [40, -90])
    const links: Link[] = [
      { a: 0, b: 1 },
      { a: 1, b: 2 }
    ]
    let energy = Infinity
    let steps = 0
    while (energy > SETTLED && steps < 5000) {
      energy = step(b, links, forces)
      steps++
    }
    expect(steps).toBeLessThan(5000)
    // And it stays settled rather than bouncing back above the line.
    for (let i = 0; i < 200; i++) {
      expect(step(b, links, forces)).toBeLessThanOrEqual(SETTLED)
    }
  })
})
