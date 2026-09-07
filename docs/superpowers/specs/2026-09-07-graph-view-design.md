# A graph worth looking at

The vault map works and looks its age. This covers three things at once,
because they are the same file and separating them would mean touching it
three times: how it looks, how it is driven, and a second way of seeing it in
three dimensions.

## What is wrong now, with numbers

`GraphView.tsx` is 839 lines holding a React component, fourteen controls, a
force simulation, a hit test and a canvas renderer. The simulation and the
drawing share one `tick`, so neither can be changed without the other.

**The repulsion is all pairs, every frame.** The inner loop compares every node
to every other node with no spatial index:

- 491 nodes, which is this repository: 120,295 comparisons a frame, 7.2 million
  a second.
- 3,721 files, the repository size quoted elsewhere in this codebase: 6.9
  million comparisons a frame, 415 million a second.

**The simulation never comes to rest.** Velocity is damped by a flat `0.85`
every frame with no sleep threshold, so an idle graph keeps integrating
forever. That is the jitter: nodes never stop moving, and the fan never stops
either.

**Nothing about the look is separable from the drawing.** Node colour, radius
and label are computed inside the draw loop, so a visual change means editing
the same function that runs the physics.

**Fourteen controls in one drawer.** Four force multipliers, three display
toggles, two encodings, two membership toggles, a query, a local-view mode and
a depth. They arrived one at a time and are presented in the order they
arrived.

## Decisions

### The look: cinematic, and it has to survive the audit

The chosen direction is cinematic dark: depth, glow, motion. This fights two
things the project enforces. Seven of the 28 themes are light, and
`e2e/ui-audit.spec.ts` measures contrast on rendered pixels for all of them,
including a bespoke canvas scanner because canvas text is invisible to computed
style. `CLAUDE.md` names the syntax palettes as the only contrast exemption
there is.

So the treatment is bounded by one rule: **effects live in non-text pixels.**
Node bodies, edges, and the depth of the background carry the glow and the
falloff. Labels stay flat, full contrast, and drawn last so nothing blooms
underneath them. Effect intensity becomes a per-theme value rather than a
constant, so the light themes get a restrained variant by construction instead
of a washed out one.

What that buys, concretely: nodes with a soft radial falloff instead of a flat
disc, edges that fade along their length toward the less important end, a
background that darkens with distance from the centre of interest, and easing
on hover and selection rather than an instant switch. What it does not buy is
shader bloom or true depth of field, which need WebGL and are deliberately not
in this change (see Out of scope).

### The seam: one simulation, swappable renderers

The component keeps React and the controls. Everything else moves out:

| New unit                       | Responsibility                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/graph-sim.ts`            | Positions over time. Pure, no DOM, no canvas. Takes nodes, edges and force settings; steps; reports whether it has settled.                    |
| `core/graph-style.ts`          | A node's radius and colour slot, and an edge's weight, from the analysis plus the encodings. Pure, already partly exists as `graph-labels.ts`. |
| `core/graph-camera.ts`         | Pan, zoom, and the 3D orbit. Converts screen to world and back. Pure.                                                                          |
| `renderer/graph/Renderer2D.ts` | Draws a frame to a 2D canvas.                                                                                                                  |
| `renderer/graph/Renderer3D.ts` | Draws a frame with depth, from the same positions.                                                                                             |
| `renderer/graph/index.ts`      | The `GraphRenderer` interface both satisfy: `draw(frame)`, `hitTest(point)`, `resize()`, `dispose()`.                                          |

`GraphView.tsx` is then a component that owns state, asks the simulation to
step, and hands a frame to whichever renderer is selected. This follows the
rule already in `CLAUDE.md`: a decision over plain values is a pure function in
`core/`, not a branch inside a draw loop. `core/graph-labels.ts` was the first
piece of this and its shape is the model for the rest.

### 3D by projection, not by WebGL

The 3D mode gives nodes a `z`, orbits the camera, and projects to the existing
2D canvas with depth sorting, size falloff and atmospheric fade. No new
dependency, no CSP question, and the pixel based contrast audit keeps working
unchanged because it is still a 2D canvas underneath.

This is a real third dimension to navigate, not a fake one: the simulation
gains a `z` axis, the camera orbits, and depth is what decides draw order,
scale and opacity. It is honest to call it 3D as long as it is equally honest
about what it is not: no volumetric lighting, no shader effects, and a lower
node ceiling before the scene reads as mush.

The `GraphRenderer` interface exists so a WebGL renderer can be added later
without touching the simulation, the camera or the component. That is the
staging: the risky part is last, and only if projection proves too flat.

### The controls: grouped, and fewer on screen

The fourteen controls stay, because each does something, but they stop being a
flat list. Three groups, in the order somebody actually reaches for them:

1. **Look at** the filter query, local mode and depth, orphans and ghosts. What
   is on the map.
2. **Show as** size by, colour by, arrows, labels, 2D or 3D. How it is drawn.
3. **Physics**, collapsed by default: the four force multipliers. Nobody
   adjusts these twice.

The mode switch between 2D and 3D belongs in the header beside the filter, not
in a drawer, because it is the one control somebody toggles repeatedly.

### Performance: measure, then fix the thing itself

The all-pairs loop and the missing sleep threshold are the two candidates, and
both are visible in the code rather than inferred. Even so, the first task is a
measurement harness that reports frame time and step time at 100, 500 and 2,000
nodes, because every performance bug in this project so far has had an obvious
cause that turned out to be wrong, and a fix aimed at the wrong 2% is wasted.

The intended fixes, to be confirmed by that harness rather than assumed:

- A Barnes-Hut quadtree (octree in 3D) for repulsion, turning the per-frame
  cost from quadratic to `n log n`.
- A sleep threshold: below a total kinetic energy, stop stepping and stop
  requesting frames. An idle graph should cost nothing.
- Separating the step from the draw, so the renderer can draw at display rate
  while the simulation runs at a fixed timestep or not at all.

## Testing

- `core/graph-sim.ts`, `core/graph-style.ts` and `core/graph-camera.ts` get unit
  tests, because they are pure and this is where the decisions now live. The
  simulation's tests are about invariants that survive a rewrite: a settled
  graph stays settled, a disconnected node does not fly to infinity, the same
  input and seed give the same positions.
- The quadtree gets a test that its forces agree with the all-pairs result
  within a tolerance, on a fixed set of positions. Without that, an `n log n`
  rewrite is a rewrite of the physics with no way to know it still behaves.
- Renderer behaviour goes through Playwright, as it does now. Both renderers
  need a `Surface` in `e2e/ui-audit.spec.ts` in the same change, and the 3D one
  needs its own: measuring 2D and calling 3D covered is how a surface that was
  never measured gets counted as coverage.
- The mode switch gets an e2e test that switching does not lose the layout, the
  filter or the selection.

## Out of scope

- **A WebGL renderer.** The interface is designed for one and the projection
  renderer is expected to be enough. Adding three.js also means answering how a
  contrast audit measures a WebGL scene, and that question deserves its own
  change rather than riding along with this one.
- **Persisting the control settings.** Every control except include-code is
  session state today. Making them stick is a small separate change and nobody
  has asked for it.
- **Edge labels.** The graph draws no edge text and this does not add any.
