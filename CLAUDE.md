# Working on Orrery

An Electron desktop app: a markdown editor and knowledge base that also edits
code, shows git and runs a terminal. TypeScript throughout, strict, React 19 and
CodeMirror 6 in the renderer.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It is short, it says where new
code goes, and every rule in it is enforced by `src/architecture.test.ts`.
[CONTRIBUTING.md](CONTRIBUTING.md) covers running the project.
[SECURITY.md](SECURITY.md) says which parts of a vault are trusted.

## Commands

Everything goes through one entry point.

```bash
./orrery.sh dev       # run it
./orrery.sh check     # lint, typecheck, unit tests. What CI runs.
./orrery.sh e2e       # the built app, driven by Playwright
./orrery.sh e2e e2e/html-reader.spec.ts   # one spec
./orrery.sh shots     # regenerate the README screenshots
./orrery.sh icon      # redraw build/icon.png from the app's own mark
```

Four things bite people who run the underlying tools directly:

- **Unit tests want `--maxWorkers=1`.** `list-layout.test.ts` is order dependent
  under parallel load. `npm run test` is fine; a bare `npx vitest` in parallel
  is where the flakes come from.
- **e2e must go through the wrapper.** `e2e/global-setup.ts` refuses an
  unwrapped run that has a display, because Electron opens real windows and a
  suite that takes over the screen is one people stop running. Use
  `npm run e2e:run -- <spec>`, never `npx playwright test`.
- **Build before e2e.** The suite drives `out/`, not the sources.
- **Formatting is enforced.** `npm run format` freely; `format:check` runs in
  CI, and `npm run lint` fails on a single warning.

`e2e/` is in neither project tsconfig, so `npm run typecheck` does not cover the
specs. Use `npx tsc -p tsconfig.json --noEmit` for those.

## Where code goes

| It needs                                | It belongs in                    |
| --------------------------------------- | -------------------------------- |
| nothing but its arguments               | `src/core/`, and it gets a test  |
| the filesystem, a process, git          | `src/main/services/`             |
| to decide whether something may run     | `src/core/`, with the most tests |
| to be named across the process boundary | `src/shared/ipc.ts`              |
| CodeMirror                              | `src/renderer/src/editor/`       |
| React                                   | `src/renderer/src/components/`   |
| to coordinate several of those          | a thin store slice               |

`src/core` runs in a bare Node process: no Electron, no DOM, no editor. Its
tests need no build step, which is why logic belongs there and not in a
component or a store callback. A store slice calls IPC and sets state; when one
starts making decisions, that decision is a pure function over a plain value and
it moves to `core/`.

## Tests

**A test that cannot fail is worse than no test**, because it is counted as
coverage. When you fix something, break the fix again and watch the test go red
before you believe it. This is not a slogan here; it has caught real mistakes
repeatedly, including several in the last week:

- A test asserted a CSS class that never existed.
- A whole file of "it ignores X" cases passed because jsdom delivers
  `postMessage` with `event.source` set to null, so the code under test rejected
  everything, including the case that was supposed to work. See
  `core/preview-reader.test.ts`, which says so at the top.
- A helper meant to guarantee a complete parse checked the tree it returned
  rather than the tree the state kept, and reported success while leaving
  3,005 of 130,888 characters unparsed.

If a test only checks that something does not happen, write the one that checks
it does. That is usually the one that catches you.

Where each kind of test lives:

- `core/` and `shared/`: unit tests, one file per module, no mocks worth the
  name.
- `main/services/`: unit tests against real temp directories and real git.
- `renderer/`: behaviour goes through Playwright against the built app. Unit
  tests cover the editor extensions that can be driven headlessly.
- **New UI needs a `Surface` in `e2e/ui-audit.spec.ts` in the same change.** It
  measures contrast and pointer target size across all 28 themes, and surfaces
  added later are surfaces that were never measured.

## Performance work

Measure first, and measure the thing itself. Every performance bug in this
project so far has had an obvious cause that turned out to be wrong:

- Opening a huge folder: suspected the graph and analytics. It was a serial
  directory walk and a recursive watcher.
- Start-up with many tabs: suspected serial file reads and store churn. Reads
  were 75ms of 4,564ms and the store updates were 6ms. The cause was
  `openPaths` setting `activeId` on every pass, so the pane displayed every
  restored file in turn.
- Start-up freezing for 15 seconds: suspected the file walk and `.gitignore`.
  The walk was 493ms. `resolveImport` was rebuilding a `Set` of every path in
  the vault, per import.

Two habits that pay for themselves. Attribute the time before changing
anything, because the fix for the wrong 2% is wasted. And remember that anything
reading the whole vault runs in **main**, so it freezes the window rather than
the page: a renderer CPU profile showing 29.7 seconds idle out of 30 is the
signature of that, not evidence the app is fine.

## Prose

The comments and commit messages here are written a particular way, and it is
worth matching because it is load bearing. A comment says _why_, and especially
why the obvious thing is wrong, since the diff already says what changed.

- **No em dashes.** Use a colon, a full stop, a comma or brackets. This applies
  to comments, commit messages, documentation and interface copy.
- No filler. Not "comprehensive", "robust", "seamless", "leverage", "delve", "in
  today's", "it is worth noting", "that said". No "not just X but Y".
- Plain British English. Say the thing.
- Prefer the concrete. "15,155ms to 1,775ms" beats "much faster". "A prefix test
  says `/vault-backup` is inside `/vault`" beats "handles edge cases".
- Comments record the trap, not the mechanism. `stripPageBase` explains what
  went wrong when a base element was left in; it does not explain what
  `querySelectorAll` does.
- If you undo a decision, correct the comment that argued for it in the same
  change. Stale reasoning is worse than none, because it will be trusted.

Commit messages: conventional prefix, lowercase subject, scope where there is an
obvious one (`feat(html)`, `fix(editor)`, `perf(graph)`). Say what was wrong
before and why, with numbers where there are numbers. Long bodies are normal
here.

## Things that will surprise you

- **A dev run and the installed app have separate userData.** When
  `!app.isPackaged` the path gains a `-dev` suffix, set before the single
  instance lock. Before that, a dev instance left running made the installed app
  exit silently with status 0.
- **A buffer is never shown in two panes.** `activate` moves focus to the pane
  already holding it; `splitRight` refuses an id that is visible.
- **Document text lives in CodeMirror state, not in Zustand.** No large string
  travels through a React render on a keystroke. `bufferRegistry` holds the
  detached state of every buffer, and builds it lazily.
- **Every IPC channel is declared once** in `shared/ipc.ts` and validated with
  zod in main. Both processes compile against that file and never import each
  other.
- **Saves go through a temp file and check the mtime first**, so a write cannot
  silently discard a change made outside the editor.
- **The HTML reader is the one place untrusted markup is rendered as markup.**
  It has its own two schemes, its own policy per document, and rules that are
  easy to undo by accident. Read `core/html-document.ts`,
  `core/preview-reader.ts` and `core/html-trust.ts` before touching any of it.
  Consent to run a page outlives the tab, keyed on the file _and_ a digest of
  it, so anything that changes what the reader hashes changes who gets trusted.
