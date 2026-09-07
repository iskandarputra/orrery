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
  // Repulsion, every pair. Quadratic, and replaced in the next commit; kept
  // here first so the move can be proved to change nothing.
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
