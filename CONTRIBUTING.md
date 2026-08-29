# Contributing

## Getting it running

```bash
./orrery.sh setup     # dependencies, Playwright browsers, Rust if present
./orrery.sh dev
```

`./orrery.sh doctor` reports what is missing. The Rust sidecar is optional — the
app falls back to the TypeScript implementation when it is not built, so you do
not need a Rust toolchain to work on anything else.

## Before you open a pull request

```bash
./orrery.sh check              # lint, typecheck, unit tests
ORRERY_XVFB=1 ./orrery.sh e2e  # the built app, driven by Playwright
```

Both are what CI runs. `ORRERY_XVFB=1` gives Playwright a virtual display; drop
it if you would rather watch.

## What the code expects of you

[ARCHITECTURE.md](ARCHITECTURE.md) is short and worth reading first — it says
where new code goes and which rules are checked by a test rather than asked for
politely. The two that catch people:

- **Logic belongs in `src/core`.** If a function needs nothing but its
  arguments, it goes there and it gets a unit test. A decision made inside a
  store callback or a component is a decision nobody can test.
- **Layers do not cross.** `core` runs in a bare Node process; `main` and
  `renderer` meet only at `shared/ipc.ts`. `src/architecture.test.ts` will tell
  you which import broke this and why the rule exists.

## Tests

A test that cannot fail is worse than no test, because it is credited as
coverage. When you fix something, break the fix and watch the test go red before
you believe it — several bugs in this repository were found exactly that way,
and one test that "passed" turned out to be checking a CSS class that did not
exist.

New UI needs a `Surface` in `e2e/ui-audit.spec.ts` in the same change. It
measures contrast and pointer-target size across all 28 themes, and surfaces
added later tend to be surfaces that were never measured.

## Formatting

Run Prettier **only on files you created**. Much of the existing tree predates
it, so a broad `prettier --write` rewrites hundreds of unrelated lines and
buries your actual change. Match the surrounding style when editing an existing
file.

## Commits

Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`). Say what
changed and why it was wrong before; the diff already says how.
