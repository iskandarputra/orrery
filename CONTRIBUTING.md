# Contributing

## Getting it running

```bash
./orrery.sh setup     # dependencies, Playwright browsers, Rust if present
./orrery.sh dev
```

`./orrery.sh doctor` reports what is missing. The Rust sidecar is optional. When
it has not been built the app falls back to the TypeScript implementation, so a
Rust toolchain is only needed if you are changing the sidecar itself.

## Before you open a pull request

```bash
./orrery.sh check   # lint, typecheck, unit tests
./orrery.sh e2e     # the built app, driven by Playwright
```

Both are what CI runs. The e2e suite drives real Electron windows on a virtual
display, so it will not take your focus while it runs; `ORRERY_HEADED=1` puts
the windows on screen when watching them is the point.

## What the code expects of you

[ARCHITECTURE.md](ARCHITECTURE.md) is short and worth reading first. It says
where new code goes and which rules a test will hold you to. Two of them catch
people:

- **Logic belongs in `src/core`.** If a function needs nothing but its
  arguments, it goes there and it gets a unit test. A decision made inside a
  store callback or a component is a decision nobody can test.
- **Layers do not cross.** `core` runs in a bare Node process; `main` and
  `renderer` meet only at `shared/ipc.ts`. `src/architecture.test.ts` will tell
  you which import broke this and why the rule exists.

## Tests

A test that cannot fail is worse than no test, because it is credited as
coverage. When you fix something, break the fix and watch the test go red before
you believe it. Several bugs here were found exactly that way, and one test that
"passed" turned out to be checking a CSS class that never existed.

The trap is usually a test that is green for a reason other than the one you
had in mind. `core/preview-reader.test.ts` says how a whole file of them got
written: jsdom delivers `postMessage` with `event.source` set to `null`, the
script under test identifies its caller by that source, so every "it ignores
X" case passed without a single rejection being exercised. The case that caught
it was the one asserting the positive, that a real message _is_ acted on. If
your test only checks that something does not happen, write the one that checks
it does.

New UI needs a `Surface` in `e2e/ui-audit.spec.ts` in the same change. It
measures contrast and pointer-target size across all 28 themes, and surfaces
added later tend to be surfaces that were never measured.

## Formatting

`npm run format`. The whole tree is Prettier-clean, and `npm run format:check`
runs in CI, so a change that is not formatted fails there rather than in review.

This advice used to be the opposite: run Prettier only on files you created,
because most of the tree predated it and a broad rewrite buried the actual
change. That is no longer true, and there is nothing left to bury.

## Commits

Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`). Say what
changed and why it was wrong before; the diff already says how.
