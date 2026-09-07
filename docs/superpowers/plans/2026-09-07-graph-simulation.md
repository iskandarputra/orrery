# Graph Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the vault map's layout fast and make it come to rest, without changing how it looks by a single pixel.

**Architecture:** The force simulation currently lives inside `GraphView.tsx`'s animation loop, sharing a function with the drawing code. It moves to `src/core/graph-sim.ts` as a pure module over plain arrays, keeping the same algorithm at first so the move can be proved harmless. Then the all-pairs repulsion is replaced with a Barnes-Hut quadtree, a sleep threshold stops the loop when the layout has settled, and stepping is separated from drawing.

**Tech Stack:** TypeScript strict, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-graph-view-design.md`

**Branch:** cut from `fix/graph-label-default`, which carries `core/graph-labels.ts`. That module is the pattern this plan follows: a decision over plain values, extracted out of the draw loop into `core/` with tests that can fail.

**This is the first of three plans** from that spec. This one is the simulation. The second is the renderer seam and the cinematic look. The third is the third dimension. They are split because each ships working software alone, and because the visual work carries contrast-audit risk that should not hold up a performance fix.

## Global Constraints

- **No em dashes** in code, comments, commit messages, documentation or interface copy. Use a colon, a full stop, a comma or brackets.
- Plain British English. No filler ("comprehensive", "robust", "seamless", "leverage", "delve"). No "not just X but Y".
- Comments say _why_, especially why the obvious thing is wrong. The diff already says what changed.
- `src/core/` must not import Electron, the DOM, or CodeMirror. `src/architecture.test.ts` enforces this and will fail if you do.
- Commits: conventional prefix, lowercase subject, scope where obvious (`perf(graph)`, `refactor(graph)`).
- **Do not run `./orrery.sh check` or the e2e suite, and do not background a long command.** Run `npm run typecheck` and your own test files in the foreground. The controller runs the full gate and e2e.
- `npm run test` now passes `--maxWorkers=1`. Run one file with `npm run test -- src/core/<file>.test.ts`.
- **Restore an experiment with a `cp` backup, never `git checkout <file>` while your work is uncommitted:** that reverts to HEAD and wipes it.
- **Anything that reads or lays out the whole vault runs in the main process or blocks the window.** Every performance bug in this project so far has had an obvious cause that turned out to be wrong, so no fix in this plan lands without a before and after number from the harness in Task 1.

## What this plan covers, and what it does not

From the spec's sections: **Performance** in full, and the `core/graph-sim.ts`
row of **The seam**. Everything else is deliberately left to the two plans that
follow, so this one can land without touching a pixel.

| Spec section                                                                        | Plan      |
| ----------------------------------------------------------------------------------- | --------- |
| Performance: measure, then fix the thing itself                                     | this plan |
| The seam: `graph-sim.ts`                                                            | this plan |
| The seam: `graph-style.ts`, `graph-camera.ts`, the renderer interface, `Renderer2D` | plan 2    |
| The look: cinematic, and it has to survive the audit                                | plan 2    |
| The controls: grouped, and fewer on screen                                          | plan 2    |
| 3D by projection, not by WebGL                                                      | plan 3    |

## File Structure

| File                                                 | Responsibility                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/graph-sim.ts` (new)                        | One step of the layout over plain arrays. Pure: no DOM, no canvas, no ids.                       |
| `src/core/graph-sim.test.ts` (new)                   | Invariants that survive a rewrite of the internals.                                              |
| `src/core/graph-sim.bench.test.ts` (new)             | Step time at 100, 500 and 2,000 bodies. Prints numbers; fails only on a catastrophic regression. |
| `src/core/quadtree.ts` (new)                         | Barnes-Hut tree over 2D bodies, and the approximated repulsion force.                            |
| `src/core/quadtree.test.ts` (new)                    | Its forces agree with all-pairs within a tolerance.                                              |
| `src/renderer/src/components/GraphView.tsx` (modify) | Keeps React, the controls and the drawing. Calls the simulation instead of containing it.        |

---

### Task 1: Know how slow it actually is

**Files:**

- Create: `src/core/graph-sim.bench.test.ts`

**Interfaces:**

- Consumes: nothing. This task deliberately measures the CURRENT algorithm, copied into the test, before any of it moves.
- Produces: a printed baseline that Tasks 3, 4 and 5 quote in their commit messages.

The spec requires a measurement before any change, because a fix aimed at the wrong 2% is wasted. The algorithm is copied into the benchmark rather than imported, because at this point it still lives inside a React component and cannot be imported at all. Task 2 replaces the copy with an import.

- [ ] **Step 1: Write the benchmark**

Create `src/core/graph-sim.bench.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and record the numbers**

Run: `npm run test -- src/core/graph-sim.bench.test.ts`
Expected: PASS, with three `all-pairs:` lines in the output. Copy those three numbers into your report. They are the baseline for the rest of the plan.

- [ ] **Step 3: Commit**

```bash
git add src/core/graph-sim.bench.test.ts
git commit -m "test(graph): measure the layout step before changing it

The repulsion is all pairs with no spatial index, which is 120,295
comparisons a frame on this repository and 6.9 million on a 3,721 file one.
That is arithmetic rather than a measurement though, and this project has a
history of performance bugs whose obvious cause turned out to be wrong, so
the number comes first.

The algorithm is copied rather than imported because it still lives inside a
React component's animation loop and cannot be imported at all. The next
commit makes it importable and deletes the copy."
```

---

### Task 2: Move the simulation into core, unchanged

**Files:**

- Create: `src/core/graph-sim.ts`
- Create: `src/core/graph-sim.test.ts`
- Modify: `src/core/graph-sim.bench.test.ts` (delete the copied `stepAllPairs`, import the real one)
- Modify: `src/renderer/src/components/GraphView.tsx` (the `tick` function's physics half)

**Interfaces:**

- Consumes: nothing from earlier tasks except the benchmark's `fixture` and `timeStep` helpers, which stay.
- Produces, and later tasks depend on these exact names:

```ts
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
export interface Forces {
  /** Multipliers, where 1 is the baseline the graph shipped with. */
  repel: number
  linkForce: number
  linkDistance: number
  center: number
}
/** Returns the layout's kinetic energy after the step. */
export function step(
  bodies: Body[],
  links: readonly Link[],
  forces: Forces,
  pinned?: number
): number
```

**The move must not change behaviour.** The algorithm, the constants (`900`, `64`, `90`, `0.004`, `0.0015`, `0.85`) and the order of the three passes stay exactly as they are. The only additions are the index-based `Link` shape and the returned energy.

Why index-based links: `GraphView` resolves `edge.from` and `edge.to` through a `Map<string, SimNode>` inside the loop today, once per edge per frame. Resolving them once per rebuild instead is both faster and what lets this module be pure.

- [ ] **Step 1: Write the failing test**

Create `src/core/graph-sim.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { step, type Body, type Forces, type Link } from './graph-sim'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/graph-sim.test.ts`
Expected: FAIL, "Failed to resolve import './graph-sim'".

- [ ] **Step 3: Write the implementation**

Create `src/core/graph-sim.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/graph-sim.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the tests can fail**

Back up the file first: `cp src/core/graph-sim.ts /tmp/sim.bak`. Then make each of these changes in turn, run the test file, record which tests go red, and restore with `cp /tmp/sim.bak src/core/graph-sim.ts` after each:

1. Remove the `Math.max(64, ...)` floor. Expected: the two-bodies-in-one-place test fails on NaN.
2. Remove the `if (i === pinned) continue`. Expected: the pinned test fails.
3. Change the damping from `0.85` to `1`. Expected: the energy-decay test fails.

If any of those three leaves the suite green, the test is not testing what it claims and must be fixed before you continue.

- [ ] **Step 6: Point the benchmark at the real thing**

In `src/core/graph-sim.bench.test.ts`, delete the copied `stepAllPairs` and its `Body` interface, import from `./graph-sim` instead, and adapt the fixture's links to the `Link` shape:

```ts
import { step, type Body, type Forces, type Link } from './graph-sim'

const forces: Forces = { repel: 1, linkForce: 1, linkDistance: 1, center: 1 }
```

`fixture` returns `links: Link[]` as `{ a: i, b: i - 1 }`, and `timeStep` calls `step(bodies, links, forces)`. The three printed numbers must be within noise of the ones recorded in Task 1: this is the check that the move changed nothing. Record both sets in your report and say whether they agree.

- [ ] **Step 7: Use it from the component**

In `src/renderer/src/components/GraphView.tsx`:

1. Import `step` and the types from `@core/graph-sim`.
2. Where `rebuild()` sets `workNodesRef` and `workEdgesRef`, also build an index-based link array once and keep it in a new `workLinksRef`, mapping each edge's `from` and `to` through the position that node holds in `workNodesRef`. Drop any edge whose end is not in the visible set, which is what `if (!a || !b) continue` did per frame.
3. In `tick`, replace the three physics passes with one call:

```ts
const pinned = drag ? nodes.indexOf(drag) : -1
step(
  nodes,
  workLinksRef.current,
  { repel: c.repel, linkForce: c.linkForce, linkDistance: c.linkDistance, center: c.center },
  pinned
)
```

`SimNode` already has `x`, `y`, `vx` and `vy`, so it satisfies `Body` structurally and needs no conversion. Leave the drawing half of `tick` exactly as it is: this task does not touch a pixel.

- [ ] **Step 8: Verify**

Run `npm run typecheck` and `npm run test -- src/core/graph-sim.test.ts src/core/graph-sim.bench.test.ts`. Both in the foreground.
Then run `npx prettier --write` on the files you changed, naming them explicitly.

- [ ] **Step 9: Commit**

```bash
git add src/core/graph-sim.ts src/core/graph-sim.test.ts src/core/graph-sim.bench.test.ts src/renderer/src/components/GraphView.tsx
git commit -m "refactor(graph): lift the layout out of the animation loop

The physics shared a function with the drawing, so neither could be changed,
tested or measured without the other. It is a computation over plain numbers,
so it belongs in core with tests, which is where graph-labels.ts went for the
same reason.

Nothing about the behaviour moves with it. The algorithm, the three passes and
every constant are identical, and the benchmark from the previous commit
reports the same cost per step, which is the point of doing the move on its
own.

Two things are new. Links are indices, because resolving edge.from through a
Map once per edge per frame was work that belonged in the rebuild. And the
step returns the layout's kinetic energy, which is what a sleep threshold will
read two commits from now."
```

---

### Task 3: Replace all-pairs repulsion with a quadtree

**Files:**

- Create: `src/core/quadtree.ts`
- Create: `src/core/quadtree.test.ts`
- Modify: `src/core/graph-sim.ts` (the repulsion pass only)
- Modify: `src/core/graph-sim.bench.test.ts` (add a line reporting the new cost)

**Interfaces:**

- Consumes: `Body` and `Forces` from `src/core/graph-sim.ts`.
- Produces:

```ts
export interface Cell {
  /** Centre of mass and total mass of everything in this cell. */
  cx: number
  cy: number
  mass: number
  /** Half the width of the square this cell covers. */
  half: number
  /** Four children, or null for a leaf. */
  kids: [Cell, Cell, Cell, Cell] | null
  /** Only on a leaf: the bodies it holds, so a query can skip itself. */
  points: readonly { x: number; y: number }[] | null
}
export function build(bodies: readonly { x: number; y: number }[]): Cell | null
/** Accumulated repulsion on one body, as [fx, fy]. */
export function repulsion(
  root: Cell | null,
  x: number,
  y: number,
  strength: number,
  theta?: number
): [number, number]
```

The reason this task is separate from Task 2, and reviewable on its own: an `n log n` rewrite of the repulsion is a rewrite of the physics. The test that its forces agree with all-pairs is the only thing that makes it safe, and that test is the deliverable here as much as the tree is.

- [ ] **Step 1: Write the failing test**

Create `src/core/quadtree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { build, repulsion } from './quadtree'

/** The exact force, by summing over every other body. */
function exact(
  bodies: { x: number; y: number }[],
  index: number,
  strength: number
): [number, number] {
  let fx = 0
  let fy = 0
  const a = bodies[index]!
  for (let j = 0; j < bodies.length; j++) {
    if (j === index) continue
    const b = bodies[j]!
    let dx = a.x - b.x
    let dy = a.y - b.y
    const d2 = Math.max(64, dx * dx + dy * dy)
    const f = strength / d2
    const d = Math.sqrt(d2)
    dx /= d
    dy /= d
    fx += dx * f
    fy += dy * f
  }
  return [fx, fy]
}

/** A fixed spread, so a failure is reproducible. */
function spread(count: number): { x: number; y: number }[] {
  let seed = 987654321
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  return Array.from({ length: count }, () => ({
    x: (next() - 0.5) * 1000,
    y: (next() - 0.5) * 1000
  }))
}

describe('build', () => {
  it('returns null for no bodies', () => {
    expect(build([])).toBeNull()
  })

  it('holds a single body as its own centre of mass', () => {
    const root = build([{ x: 10, y: -4 }])!
    expect(root.mass).toBe(1)
    expect(root.cx).toBeCloseTo(10)
    expect(root.cy).toBeCloseTo(-4)
  })

  it('sums the mass of everything it contains', () => {
    const root = build(spread(50))!
    expect(root.mass).toBe(50)
  })

  it('does not recurse forever on bodies in the same place', () => {
    // Identical positions cannot be separated by subdivision, so a tree that
    // splits until each cell holds one body would never stop. This must
    // return rather than overflow the stack.
    const same = Array.from({ length: 20 }, () => ({ x: 5, y: 5 }))
    const root = build(same)!
    expect(root.mass).toBe(20)
  })
})

describe('repulsion agrees with all pairs', () => {
  it('is within a few percent of the exact force at theta 0.5', () => {
    // The whole safety argument for the rewrite. An approximation is fine; an
    // approximation nobody compared against the truth is not.
    const bodies = spread(400)
    const root = build(bodies)
    let worst = 0
    for (let i = 0; i < bodies.length; i++) {
      const [ax, ay] = exact(bodies, i, 900)
      const [bx, by] = repulsion(root, bodies[i]!.x, bodies[i]!.y, 900)
      const size = Math.hypot(ax, ay)
      if (size < 1e-9) continue
      worst = Math.max(worst, Math.hypot(ax - bx, ay - by) / size)
    }
    expect(worst).toBeLessThan(0.05)
  })

  it('is exact when theta is 0, because every body is visited', () => {
    const bodies = spread(60)
    const root = build(bodies)
    for (let i = 0; i < bodies.length; i++) {
      const [ax, ay] = exact(bodies, i, 900)
      const [bx, by] = repulsion(root, bodies[i]!.x, bodies[i]!.y, 900, 0)
      expect(bx).toBeCloseTo(ax, 6)
      expect(by).toBeCloseTo(ay, 6)
    }
  })

  it('scales with strength', () => {
    const bodies = spread(30)
    const root = build(bodies)
    const [ax] = repulsion(root, bodies[0]!.x, bodies[0]!.y, 900)
    const [bx] = repulsion(root, bodies[0]!.x, bodies[0]!.y, 1800)
    expect(bx).toBeCloseTo(ax * 2, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/quadtree.test.ts`
Expected: FAIL, "Failed to resolve import './quadtree'".

- [ ] **Step 3: Write the implementation**

Create `src/core/quadtree.ts`:

```ts
/**
 * Barnes-Hut over the map's bodies, so repulsion stops being quadratic.
 *
 * All pairs cost 120,295 comparisons a frame on this repository and 6.9
 * million on a 3,721 file one. A distant cluster pulls on a node almost
 * exactly as its centre of mass would, so the tree lets one visit stand in for
 * hundreds, and `theta` is how much error that is allowed to introduce.
 *
 * The force is the same one the all-pairs loop applied, including the squared
 * distance floor: without it two nodes in the same place divide by zero.
 */

export interface Cell {
  /** Centre of mass and total mass of everything in this cell. */
  cx: number
  cy: number
  mass: number
  /** Half the width of the square this cell covers. */
  half: number
  /** Four children, or null for a leaf. */
  kids: [Cell, Cell, Cell, Cell] | null
  /**
   * Only on a leaf: the bodies it holds.
   *
   * Kept because a leaf has to be summed body by body rather than through its
   * centre of mass. A leaf can hold more than one body (identical positions,
   * or the depth cap), and standing in for them with an average would apply
   * the querying body's own force to itself, which nothing downstream could
   * detect and which would make `theta` 0 inexact.
   */
  points: readonly Point[] | null
}

export interface Point {
  x: number
  y: number
}

/**
 * Subdivision stops here.
 *
 * Bodies at identical positions can never be separated, so a tree that split
 * until every cell held one body would recurse until the stack ran out. A
 * vault with two notes at the same coordinates is not exotic: it is what a
 * fresh layout looks like before the first step spreads them.
 */
const MAX_DEPTH = 20

function leaf(points: readonly Point[], half: number): Cell {
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  const mass = points.length
  return { cx: cx / mass, cy: cy / mass, mass, half, kids: null, points }
}

function subdivide(
  points: readonly Point[],
  cx: number,
  cy: number,
  half: number,
  depth: number
): Cell {
  if (points.length <= 1 || depth >= MAX_DEPTH) return leaf(points, half)

  const quads: Point[][] = [[], [], [], []]
  for (const p of points) {
    const q = (p.x >= cx ? 1 : 0) + (p.y >= cy ? 2 : 0)
    quads[q]!.push(p)
  }
  // Every body landed in one quadrant, so splitting again would produce the
  // same cell forever. Stop here rather than recurse.
  if (quads.some((q) => q.length === points.length)) return leaf(points, half)

  const quarter = half / 2
  const kids = quads.map((q, i) => {
    const kx = cx + (i & 1 ? quarter : -quarter)
    const ky = cy + (i & 2 ? quarter : -quarter)
    return q.length === 0
      ? { cx: kx, cy: ky, mass: 0, half: quarter, kids: null, points: [] }
      : subdivide(q, kx, ky, quarter, depth + 1)
  }) as [Cell, Cell, Cell, Cell]

  let mx = 0
  let my = 0
  let mass = 0
  for (const kid of kids) {
    mx += kid.cx * kid.mass
    my += kid.cy * kid.mass
    mass += kid.mass
  }
  return { cx: mx / mass, cy: my / mass, mass, half, kids, points: null }
}

export function build(bodies: readonly Point[]): Cell | null {
  if (bodies.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of bodies) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x > maxX) maxX = b.x
    if (b.y > maxY) maxY = b.y
  }
  // A square, because a rectangle would make `half` mean two different things.
  const half = Math.max(1, (Math.max(maxX - minX, maxY - minY) / 2) * 1.01)
  return subdivide(bodies, (minX + maxX) / 2, (minY + maxY) / 2, half, 0)
}

/**
 * Repulsion on the body at `x, y`, as `[fx, fy]`.
 *
 * A cell stands in for its contents when it is far enough away that its width
 * over its distance is below `theta`. At `theta` 0 nothing is approximated and
 * the result matches all pairs exactly, which is what the test uses to prove
 * the approximation is the only difference.
 */
export function repulsion(
  root: Cell | null,
  x: number,
  y: number,
  strength: number,
  theta = 0.5
): [number, number] {
  let fx = 0
  let fy = 0

  /** The pair force the all-pairs loop applied, from one body at `px, py`. */
  const pair = (px: number, py: number, mass: number): void => {
    let dx = x - px
    let dy = y - py
    const d2 = dx * dx + dy * dy
    // Zero distance is the body itself, or one sitting exactly on top of it.
    // All pairs gave both of those a zero direction and therefore no force, so
    // skipping them here is the same answer, not a different one.
    if (d2 === 0) return
    const floored = Math.max(64, d2)
    const d = Math.sqrt(floored)
    const f = (strength * mass) / floored
    dx /= d
    dy /= d
    fx += dx * f
    fy += dy * f
  }

  const visit = (cell: Cell): void => {
    if (cell.mass === 0) return
    // A leaf is summed body by body. It is the only place the querying body
    // can be, and the only place its own force could leak in.
    if (cell.kids === null) {
      for (const p of cell.points!) pair(p.x, p.y, 1)
      return
    }
    const dx = x - cell.cx
    const dy = y - cell.cy
    if (cell.half * 2 < theta * Math.hypot(dx, dy)) {
      pair(cell.cx, cell.cy, cell.mass)
      return
    }
    for (const kid of cell.kids) visit(kid)
  }
  if (root) visit(root)
  return [fx, fy]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/quadtree.test.ts`
Expected: PASS, 7 tests.

If the agreement test fails, do not loosen the tolerance. A tolerance raised to make a test pass is a test that no longer says anything. Find the disagreement.

- [ ] **Step 5: Use it in the step**

In `src/core/graph-sim.ts`, replace the whole all-pairs repulsion loop with:

```ts
// One tree per step. Building it costs a pass over the bodies, which is
// nothing next to the pairs it saves.
const tree = build(bodies)
for (const body of bodies) {
  const [fx, fy] = repulsion(tree, body.x, body.y, 900 * forces.repel)
  body.vx += fx
  body.vy += fy
}
```

Import `build` and `repulsion` from `./quadtree`. Update the comment above the pass: it currently says the loop is quadratic and will be replaced, and that is the reasoning this commit undoes.

- [ ] **Step 6: Confirm the simulation still behaves**

Run: `npm run test -- src/core/graph-sim.test.ts src/core/quadtree.test.ts`
Expected: PASS. Every test in `graph-sim.test.ts` was written against the all-pairs version and must still hold: that is the point of having written them first.

- [ ] **Step 7: Measure the change**

Add a second case to `src/core/graph-sim.bench.test.ts` so it prints both, and run it. Record the before and after for all three sizes. Expect the 2,000 body case to improve by an order of magnitude or more; if it does not, say so rather than shipping it, because the whole justification for the rewrite is that number.

- [ ] **Step 8: Commit**

```bash
git add src/core/quadtree.ts src/core/quadtree.test.ts src/core/graph-sim.ts src/core/graph-sim.bench.test.ts
git commit -m "perf(graph): stop comparing every node to every other node

Repulsion was all pairs, which is 120,295 comparisons a frame on this
repository and 6.9 million on a 3,721 file one, every frame, forever. A
distant cluster pulls on a node almost exactly as its centre of mass does, so
one visit now stands in for hundreds.

Replace this line with the three before and after numbers you recorded, in the
form '2,000 bodies: 41.2ms to 1.9ms per step'. The plan's whole justification
is that difference and the commit is where it belongs.

The agreement test is the reason this is safe to do. An n log n rewrite of the
repulsion is a rewrite of the physics, and the only thing separating it from
a guess is a comparison against the exact force: within 5% at theta 0.5, and
exact at theta 0, where nothing is approximated at all.

MAX_DEPTH exists because bodies at identical positions cannot be separated by
subdivision, and a fresh layout has plenty of those before the first step."
```

---

### Task 4: Let the layout come to rest

**Files:**

- Modify: `src/core/graph-sim.ts` (export a threshold)
- Modify: `src/core/graph-sim.test.ts` (add the settling test)
- Modify: `src/renderer/src/components/GraphView.tsx` (the animation loop)

**Interfaces:**

- Consumes: the energy already returned by `step`.
- Produces: `export const SETTLED = 0.02` from `src/core/graph-sim.ts`.

Velocity is damped by a flat `0.85` with no threshold, so an idle graph integrates forever: it never stops moving and never stops asking for frames. That is the jitter, and it is also why the graph costs CPU when nobody is looking at it.

- [ ] **Step 1: Write the failing test**

Append to `src/core/graph-sim.test.ts`:

```ts
import { SETTLED } from './graph-sim'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/graph-sim.test.ts`
Expected: FAIL, `SETTLED` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/core/graph-sim.ts`:

```ts
/**
 * Kinetic energy below which the layout is done moving.
 *
 * Read by the animation loop to stop stepping and stop asking for frames. The
 * graph used to damp velocity by a flat 0.85 with nothing testing the result,
 * so it integrated forever: nodes never came to rest, and an idle map cost the
 * same as a moving one.
 *
 * Tuned against `graph-sim.test.ts`: high enough that a four body layout
 * reaches it in well under 5,000 steps, low enough that the arrangement has
 * visibly stopped rather than merely slowed.
 */
export const SETTLED = 0.02
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/core/graph-sim.test.ts`
Expected: PASS.

If the layout does not reach `SETTLED` within 5,000 steps, do not raise the constant to make the test pass. Work out what is still moving: a body oscillating around the centre means the gravity and damping are fighting, and that is a real finding worth reporting.

- [ ] **Step 5: Stop the loop in the component**

In `src/renderer/src/components/GraphView.tsx`'s `tick`:

1. Keep the energy the step returns.
2. Track a `sleeping` flag alongside the existing `raf` handle. When the energy is at or below `SETTLED` and nothing is being dragged, stop calling `requestAnimationFrame` and set the flag.
3. Wake on anything that changes the layout or the view: a drag start, a pan, a zoom, a rebuild, a rescan, a control change, and a window resize. Each of those already has a handler; each needs to clear the flag and restart the loop if it is set.
4. A frame must still be drawn when the view changes while asleep, or panning a settled graph would move nothing. The simplest correct thing is to wake, step once, draw, and settle again.

Write the wake path as one named function called from each of those handlers rather than repeating the two lines, so a future handler that forgets to wake is a visible omission rather than a silent freeze.

- [ ] **Step 6: Verify**

Run `npm run typecheck` and `npm run test -- src/core/graph-sim.test.ts` in the foreground, then `npx prettier --write` on the files you changed.

Report clearly that the awake/asleep behaviour of the component is NOT covered by an automated test in this task, and why: it is renderer behaviour driven by an animation loop, and the project drives that through Playwright. The controller will exercise it. Say which handlers you wired to the wake path so the reviewer can check for a missing one.

- [ ] **Step 7: Commit**

```bash
git add src/core/graph-sim.ts src/core/graph-sim.test.ts src/renderer/src/components/GraphView.tsx
git commit -m "perf(graph): let the map stop moving

Velocity was damped by a flat 0.85 with nothing reading the result, so the
layout integrated forever. Nodes never came to rest, which is the jitter, and
an idle graph asked for a frame sixty times a second and got one, which is
why the fan runs while nobody is looking at the map.

The step already reported its kinetic energy. Below SETTLED the loop stops
asking for frames, and every handler that changes the layout or the view wakes
it through one named function, so a handler that forgets to wake is a missing
call rather than a graph that silently freezes."
```

---

### Task 5: Separate stepping from drawing

**Files:**

- Modify: `src/renderer/src/components/GraphView.tsx`

**Interfaces:**

- Consumes: `step` and `SETTLED` from `src/core/graph-sim.ts`.
- Produces: nothing new. This is the last task of this plan, and the seam it leaves is what the second plan's renderer extraction builds on.

`tick` steps the physics and draws in one function, so the layout advances exactly once per drawn frame. That couples the arrangement to the display: on a 120Hz screen the layout settles in half the wall-clock time it takes on a 60Hz one, and a dropped frame is a dropped step.

- [ ] **Step 1: Split the function**

In `tick`, separate the two halves into `advance()` and `draw()`, called in that order from the frame callback. Nothing else changes yet: this step is purely making the seam visible, and the file must behave identically.

- [ ] **Step 2: Drive the physics on a fixed timestep**

Accumulate the elapsed time each frame and run `advance()` in fixed increments of 16ms, up to a cap of three per frame so a long pause does not produce a burst of catch-up steps that flings the layout apart. Draw once per frame regardless.

```ts
const now = performance.now()
let lag = Math.min(now - last, 48)
last = now
while (lag >= 16) {
  energy = advance()
  lag -= 16
}
draw()
```

Keep `last` and `lag` alongside the existing loop state. The cap of 48ms is three steps: past that the layout is better off arriving slightly late than arriving wrong.

- [ ] **Step 3: Verify**

Run `npm run typecheck` in the foreground. Then run the app and watch the graph: `./orrery.sh dev`. Open a vault with enough notes to see the layout arrange itself, and check three things by eye, reporting each:

1. It arranges and then visibly stops.
2. Panning and zooming a settled graph moves the view.
3. Dragging a node still works, and releasing it lets the layout settle again.

This is the one task in the plan whose deliverable can only be judged by watching it, and saying so is more use than a test that asserts nothing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/GraphView.tsx
git commit -m "refactor(graph): step the layout on a clock, not on a frame

Stepping and drawing were one function, so the arrangement advanced once per
drawn frame. That tied the layout to the display: the same vault settled in
half the time on a 120Hz screen, and a dropped frame was a dropped step.

The physics now runs in fixed 16ms increments and the canvas draws once a
frame. Catch-up is capped at three steps, because after a long pause a burst
of them flings the arrangement apart, and a layout that arrives slightly late
beats one that arrives wrong.

The two halves being separable is also what the renderer extraction in the
next plan needs, and it is easier to see now that they are named."
```

---

## Final verification

- [ ] Run `./orrery.sh check`. Expected: PASS.
- [ ] Run `./orrery.sh e2e e2e/ui-audit.spec.ts`. Expected: PASS. This plan changes no pixels, so the graph surfaces must pass unchanged. If they do not, something visual moved that should not have.
- [ ] Run `./orrery.sh e2e`. Expected: PASS.
- [ ] Quote the harness numbers from Task 1 and Task 3 side by side. The plan's justification is that difference, and a plan that cannot show it did not achieve what it set out to.
- [ ] Prove the agreement test can fail: change `theta` in `quadtree.ts`'s default from `0.5` to `5`, confirm the 5% agreement test goes red, and restore. A tolerance nobody has seen fail is a tolerance that is not measuring the approximation.
