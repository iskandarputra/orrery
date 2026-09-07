import { describe, expect, it } from 'vitest'
import { step, type Body, type Forces, type Link } from './graph-sim'

const forces: Forces = { repel: 1, linkForce: 1, linkDistance: 1, center: 1 }

/** A layout of `count` bodies with a link from each to the one before it. */
export function fixture(count: number): { bodies: Body[]; links: Link[] } {
  // A fixed pseudo-random spread rather than Math.random, so a slow run and a
  // fast run are measuring the same arrangement.
  let seed = 12345
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const bodies: Body[] = Array.from({ length: count }, () => ({
    x: (next() - 0.5) * 800,
    y: (next() - 0.5) * 800,
    vx: 0,
    vy: 0
  }))
  const links: Link[] = []
  for (let i = 1; i < count; i++) links.push({ a: i, b: i - 1 })
  return { bodies, links }
}

/** Milliseconds for one step, averaged over enough steps to be stable. */
export function timeStep(
  count: number,
  step: (b: Body[], l: readonly Link[], f: Forces) => number
): number {
  const { bodies, links } = fixture(count)
  const runs = count > 1000 ? 20 : 200
  const started = performance.now()
  for (let i = 0; i < runs; i++) step(bodies, links, forces)
  return (performance.now() - started) / runs
}

describe('layout step cost, all pairs', () => {
  it('reports the cost per step at three vault sizes', () => {
    const sizes = [100, 500, 2000]
    const results = sizes.map((n) => ({ n, ms: timeStep(n, step) }))
    for (const { n, ms } of results) {
      console.log(`all-pairs: ${n} bodies, ${ms.toFixed(3)}ms per step`)
    }

    // Not a performance assertion, which would be flaky on a loaded machine.
    // This only catches a change that makes the layout unusable: at 60fps a
    // step has 16ms, and 2,000 bodies taking a whole second means the window
    // is frozen rather than slow.
    const worst = results[results.length - 1]!.ms
    expect(worst).toBeLessThan(1000)
  })
})
