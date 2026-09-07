import { describe, expect, it } from 'vitest'

/**
 * The layout step as `GraphView.tsx` runs it today, copied rather than
 * imported because it still lives inside a React component's animation loop.
 *
 * Task 2 deletes this copy and imports the real thing. Until then this is the
 * baseline every later task in the plan is measured against, and copying it is
 * the only way to have a number before the refactor rather than after.
 */
interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

function stepAllPairs(bodies: Body[], links: [number, number][]): void {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!
      let dx = a.x - b.x
      let dy = a.y - b.y
      const d2 = Math.max(64, dx * dx + dy * dy)
      const f = 900 / d2
      const d = Math.sqrt(d2)
      dx /= d
      dy /= d
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }
  }
  const rest = 90
  const spring = 0.004
  for (const [ai, bi] of links) {
    const a = bodies[ai]!
    const b = bodies[bi]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.max(1, Math.hypot(dx, dy))
    const f = (d - rest) * spring
    a.vx += (dx / d) * f
    a.vy += (dy / d) * f
    b.vx -= (dx / d) * f
    b.vy -= (dy / d) * f
  }
  const gravity = 0.0015
  for (const n of bodies) {
    n.vx = (n.vx - n.x * gravity) * 0.85
    n.vy = (n.vy - n.y * gravity) * 0.85
    n.x += n.vx
    n.y += n.vy
  }
}

/** A layout of `count` bodies with a link from each to the one before it. */
export function fixture(count: number): { bodies: Body[]; links: [number, number][] } {
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
  const links: [number, number][] = []
  for (let i = 1; i < count; i++) links.push([i, i - 1])
  return { bodies, links }
}

/** Milliseconds for one step, averaged over enough steps to be stable. */
export function timeStep(count: number, step: (b: Body[], l: [number, number][]) => void): number {
  const { bodies, links } = fixture(count)
  const runs = count > 1000 ? 20 : 200
  const started = performance.now()
  for (let i = 0; i < runs; i++) step(bodies, links)
  return (performance.now() - started) / runs
}

describe('layout step cost, all pairs', () => {
  it('reports the cost per step at three vault sizes', () => {
    const sizes = [100, 500, 2000]
    const results = sizes.map((n) => ({ n, ms: timeStep(n, stepAllPairs) }))
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
