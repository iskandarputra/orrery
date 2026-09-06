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
tests need no Electron, no browser and no build step: 68 modules, one test
file each, and the whole suite is seconds. That is why logic belongs there
and not in a component or a store.

## Where does this code go?

Ask what it needs:

| It needs…                               | It belongs in                |
| --------------------------------------- | ---------------------------- |
| nothing but its arguments               | `core/`, and it gets a test  |
| the filesystem, a process, git          | `main/services/`             |
| to decide whether something may run     | `core/`, with the most tests |
| to be named across the process boundary | `shared/ipc.ts`              |
| CodeMirror                              | `renderer/src/editor/`       |
| React                                   | `renderer/src/components/`   |
| to coordinate several of the above      | a thin store slice           |

**A store slice is orchestration, not logic.** It calls IPC, sets state, and
decides nothing on its own. When a slice starts making decisions, such as which
tab to activate next or how to rearrange panes, that decision is a pure function
over a plain value and it goes in `core/`. `core/tab-layout.ts` is the worked
example: it came out of a `set()` callback where none of its rules could be
tested.

## Seams worth knowing

**`state/app-state-access.ts`.** Editor extensions, menus and note commands need
application state, and the store loads them, so importing `store.ts` from there
is a runtime cycle. They call `appState()` instead, from a module that imports
nothing. It is also how a test gives one of those modules a state of its own.

**`services/ask-user.ts`.** IPC runs one way, the renderer asking and main
answering, except here. MCP needs main to ask the person at the keyboard something in the
middle of a call: may this tool run, fill in this form, may this server borrow
the model. Main sends `mcp:ask`, the renderer answers on `mcp:answer`, and the
pending promise settles. Every path settles, and every path that is not an
explicit yes settles as no: no window, no answer in time, the window closing, an
answer arriving late.

**`main/preview-protocol.ts`.** The HTML reader shows a document nobody
vouched for, and gets two schemes for it rather than sharing the app's.
`orrery-preview://` serves the page itself, so its Content-Security-Policy is a
response header on a document of its own. A `srcdoc` frame inherits the
embedding page's policy and can only ever be narrower, which made "run this
page's scripts" impossible without loosening the whole app. `orrery-page://`
serves the files that page may load, addressed by preview id and a path inside
that preview's root, so main decides what a request resolves to rather than
taking the document's word. Where the line falls is pure and tested in
`core/preview-asset.ts`; that it holds in a browser is tested in
`e2e/html-reader.spec.ts`.

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

`./orrery.sh check` (lint, typecheck, unit) · `./orrery.sh e2e` ·
`./orrery.sh dev` · `./orrery.sh package`
