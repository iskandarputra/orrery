/**
 * One step of the vault map's layout.
 *
 * Lifted out of `GraphView.tsx`, where it shared a function with the drawing
 * code and so could not be changed or measured on its own. The algorithm and
 * every constant are unchanged by that move on purpose: a refactor that also
 * alters behaviour cannot be proved harmless.
 *
 * Links are indices rather than ids because the caller already knows the
 * order. Resolving `edge.from` through a Map once per edge per frame, which is
 * what the component did, is work that belongs in the rebuild rather than in
 * the loop.
 */

export interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

export interface Link {
  a: number
  b: number
}

/**
 * Kinetic energy PER BODY below which the layout is done moving.
 *
 * `step` returns a sum over every body, so comparing that sum against a fixed
 * total made the threshold stricter in exact proportion to how many bodies
 * were in the layout: four bodies had to share 0.02 between them, but 491
 * bodies (this repository's own vault) had to share the same 0.02, a hundred
 * times less each, for no reason anybody chose. Measured against this
 * repository's graph, that cost 11,149 steps (185.8s at 60 steps a second) to
 * reach the same total a four body layout reaches in 4,139 steps (69.0s) of
 * per-body energy. The feature was weakest on the vaults where an idle graph
 * burning frames costs the most.
 *
 * Use `settled`, not this constant directly, so the division by body count
 * lives in one place.
 *
 * Tuned against `graph-sim.test.ts`: a four body layout reaches roughly this
 * per-body energy (0.0049) in well under 5,000 steps, low enough that the
 * arrangement has visibly stopped rather than merely slowed.
 */
export const SETTLED = 0.005

/**
 * Whether the layout has stopped moving, judged per body rather than by the
 * raw total `step` returns. `bodies <= 0` counts as settled: nothing is left
 * to move, and dividing by zero bodies is not a question with a numeric
 * answer.
 */
export function settled(energy: number, bodies: number): boolean {
  return bodies <= 0 || energy / bodies <= SETTLED
}

/** Fixed physics timestep, in milliseconds. Independent of the screen's refresh rate. */
export const STEP_MS = 16

/**
 * How many steps a single frame may take when it is catching up after a
 * stall (a backgrounded tab, a slow machine): past this, a burst of steps
 * flings the layout apart rather than letting it arrive slightly late.
 */
export const MAX_CATCHUP_STEPS = 3

/**
 * Turn an accumulated lag into a whole number of fixed timesteps, keeping
 * the sub-step remainder for the next call.
 *
 * `lag` must be the caller's running total, not the elapsed time since the
 * last frame on its own. A frame faster than STEP_MS, which is every frame
 * above 60Hz, buys less than one full step by itself: thrown away instead of
 * carried forward, that remainder never crosses the line and a 75Hz, 90Hz,
 * 120Hz or 144Hz display never steps at all. See graph-sim.test.ts's
 * accumulator case, which is the test that would have caught that bug.
 *
 * `maxSteps` bounds how many steps this one call can hand back, regardless
 * of how much lag is waiting.
 */
export function drainSteps(lag: number, maxSteps: number): { steps: number; lag: number } {
  let steps = 0
  while (lag >= STEP_MS && steps < maxSteps) {
    lag -= STEP_MS
    steps++
  }
  return { steps, lag }
}

/**
 * How many steps the next frame may run, tightened after a step that cost
 * more than its own budget.
 *
 * Somewhere around 5,000 nodes a single step starts to cost more than
 * STEP_MS. Once that happens, the frame delta that measures it is large too,
 * so the ordinary cap of `MAX_CATCHUP_STEPS` would spend that same frame on
 * three of them in a row: roughly three times the blocking chunk the cap
 * exists to bound, just paid by fewer, longer frames instead of many short
 * ones. Capping to one trades a slower catch-up for a smaller one.
 */
export function catchupCap(lastStepMs: number): number {
  return lastStepMs > STEP_MS ? 1 : MAX_CATCHUP_STEPS
}

export interface Forces {
  /** Multipliers, where 1 is the baseline the graph shipped with. */
  repel: number
  linkForce: number
  linkDistance: number
  center: number
}

/**
 * Advance the layout, and report its kinetic energy.
 *
 * `pinned` is the index of a body being dragged, which must not be moved by
 * the physics or it fights the pointer. Negative means nothing is pinned.
 *
 * The energy is the sum of squared speeds. It is returned rather than computed
 * by the caller because the caller would have to walk every body again to get
 * it, and this loop is already there.
 */
export function step(bodies: Body[], links: readonly Link[], forces: Forces, pinned = -1): number {
  // Repulsion, every pair, deliberately: a Barnes-Hut quadtree was built,
  // tested to agree with this within 3.85%, and measured against it
  // (`graph-sim.bench.test.ts`). All-pairs won at every size this project
  // has: 4.6 times slower at 100 bodies, 1.9 times slower at 500, only 1.14
  // times faster at 2,000. The crossover is somewhere around 5,000 to 8,000
  // bodies; below that a tight quadratic loop over plain arrays beats a tree
  // of JS objects, which is cache hostile and carries a large constant
  // factor. Revisit with a fresh measurement if a vault ever grows past that.
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!
      let dx = a.x - b.x
      let dy = a.y - b.y
      // Floored, because two nodes in the same place would otherwise divide by
      // zero and both leave for NaN.
      const d2 = Math.max(64, dx * dx + dy * dy)
      const f = (900 * forces.repel) / d2
      const d = Math.sqrt(d2)
      dx /= d
      dy /= d
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }
  }

  const rest = 90 * forces.linkDistance
  const spring = 0.004 * forces.linkForce
  for (const link of links) {
    const a = bodies[link.a]
    const b = bodies[link.b]
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.max(1, Math.hypot(dx, dy))
    const f = (d - rest) * spring
    a.vx += (dx / d) * f
    a.vy += (dy / d) * f
    b.vx -= (dx / d) * f
    b.vy -= (dy / d) * f
  }

  const gravity = 0.0015 * forces.center
  let energy = 0
  for (let i = 0; i < bodies.length; i++) {
    if (i === pinned) continue
    const n = bodies[i]!
    n.vx = (n.vx - n.x * gravity) * 0.85
    n.vy = (n.vy - n.y * gravity) * 0.85
    n.x += n.vx
    n.y += n.vy
    energy += n.vx * n.vx + n.vy * n.vy
  }
  return energy
}
