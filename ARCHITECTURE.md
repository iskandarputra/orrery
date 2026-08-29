# Architecture

The rules the codebase is held to, and where to put new code. Every rule here is
checked by `src/architecture.test.ts`. Break one and that test tells you which
import did it and why the rule exists. An architecture nobody can violate by
accident is the only kind that survives.

## The layers

```
core ───────► (nothing)          pure logic; no Electron, no DOM, no editor
shared ─────► core               the IPC contract, read by both processes
main ───────► core, shared       Electron main: files, git, LSP, terminal
preload ────► shared             the bridge, and nothing else
renderer ───► core, shared       React, CodeMirror, the whole UI
```

Nothing points back up the list. `main` and `renderer` never import each other.
They meet at `shared/ipc.ts`, the only description of what may cross.

**`src/core` is the important one.** It runs in a bare Node process, so its
tests need no Electron, no browser and no build step: 36 modules, one test file each, and the whole suite is seconds. That is why logic belongs there
and not in a component or a store.

## Where does this code go?

Ask what it needs:

| It needs…                               | It belongs in               |
| --------------------------------------- | --------------------------- |
| nothing but its arguments               | `core/`, and it gets a test |
| the filesystem, a process, git          | `main/services/`            |
| to be named across the process boundary | `shared/ipc.ts`             |
| CodeMirror                              | `renderer/src/editor/`      |
| React                                   | `renderer/src/components/`  |
| to coordinate several of the above      | a thin store slice          |

**A store slice is orchestration, not logic.** It calls IPC, sets state, and
decides nothing on its own. When a slice starts making decisions, such as which
tab to activate next or how to rearrange panes, that decision is a pure function
over a plain value and it goes in `core/`. `core/tab-layout.ts` is the worked
example: it came out of a `set()` callback where none of its rules could be
tested.

## Two seams worth knowing

**`state/app-state-access.ts`.** Editor extensions, menus and note commands need
application state, and the store loads them, so importing `store.ts` from there
is a runtime cycle. They call `appState()` instead, from a module that imports
nothing. It is also how a test gives one of those modules a state of its own.

**`plugins/api.ts`.** Commands, editor extensions, and whole document surfaces
are contributed through `PluginContext`. A surface claims files by name and
renders in place of the editor, reading and writing the buffer's document like
any other view of it, so dirty state, saving and undo stay the app's own.
Excalidraw is a built-in that uses only what a community plugin can reach.

## Testing

- **`core/`**: unit tests, one file each, no mocks worth the name.
- **`main/services/`**: unit tests against real temp directories and real git.
- **`renderer/`**: behaviour goes through Playwright against the built app. Unit
  tests cover the editor extensions that can be driven headlessly.
- **`e2e/ui-audit.spec.ts`**: every surface is measured for contrast and target
  size in all 28 themes. **Add a `Surface` in the same change as the UI**, and
  restore panel state in its `close()`.

A test that cannot fail is worse than no test. When you fix something, break the
fix and watch the test go red before you believe it.

## Commands

`./orrery.sh check` (lint, typecheck, unit) · `ORRERY_XVFB=1 ./orrery.sh e2e` ·
`./orrery.sh dev` · `./orrery.sh package`
