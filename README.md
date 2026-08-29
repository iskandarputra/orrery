<h1 align="center">Orrery</h1>

<p align="center">
  A markdown editor that models the shape of what you write.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F.svg">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <img alt="tests" src="https://img.shields.io/badge/tests-648%20unit%20%C2%B7%20176%20e2e-success.svg">
</p>

![The editor, showing live preview of headings, wikilinks, a table, a highlight and KaTeX math](docs/screenshots/editor.png)

An orrery is a clockwork model of a solar system. It does not merely hold the
planets — it shows how they move and what they pull on.

This is a markdown editor built on the same idea. Your notes are the bodies and
the links between them are the forces, so the structure of what you have written
is something you can see, search and navigate rather than something you have to
hold in your head.

It also turns out that a knowledge base which takes its own vault seriously
needs to be a decent code editor, a git client and a terminal — because that is
what is in the folder you are pointing it at.

## Writing

**Live preview, not a preview pane.** You are always editing real markdown.
Formatting renders inline — headings size up, bold is bold, links show their
label — and the syntax markers reappear exactly where the cursor lands. The
document is never converted to and from a rich-text model, so the file on disk is
what you typed.

Three modes on `Ctrl+Shift+1/2/3`: **Edit** (raw source), **Hybrid** (the
default), **Reading** (fully rendered, read-only).

Tables render as tables. `$inline$` and `$$block$$` maths through KaTeX.
` ```mermaid ` fences render as diagrams. `==Highlights==` get a marker pen.
Images and diagrams open full-screen. Code fences scroll inside their own card
rather than dragging the document sideways.

**28 themes**, 17 dark and 11 light, each a six-line palette from which the full
token set is derived. Every one of them is checked against WCAG AA contrast and
pointer-target size by a test that runs on every change.

## A vault, not a pile of files

Point Orrery at a folder and it reads the whole thing.

`[[Wikilinks]]` connect notes by name — `[[Note]]`, `[[Note#Heading]]`,
`[[Note|alias]]`. Typing `[[` completes from the vault index, `Ctrl+click`
follows, and following a link to a note that does not exist yet creates it.
Links inside code fences are left alone, because a snippet showing the syntax is
not a reference.

**Backlinks** (`Ctrl+Shift+B`) show every note pointing at this one, with the
line each mention sits on. **Tags**, an **outline**, and per-note **analysis**
each get a panel.

**Search** covers every text file in the vault, not only the notes — match case,
whole word, regular expressions, and comma-separated globs for the files to
include and exclude (`*.md`, `src/**`, `**/*.test.ts`). Binary files are skipped
by looking inside them rather than by trusting the extension.

![The knowledge graph, showing 28 notes in four clusters joined by 71 links](docs/screenshots/graph.png)

The **graph** (`Ctrl+Shift+G`) is the whole vault as a force-directed map: drag
it, zoom it, hover to spotlight what a note connects to, click to open. Size
nodes by links, influence or bridging; colour them by cluster or folder. Narrow
to a local view of what is within _n_ hops of the note you are reading. Notes
that are linked to but do not exist show as ghosts, so gaps are visible.

## Code, git and a terminal

A vault is a folder, and folders have code in them.

![A side-by-side diff with a minimap, the source control panel, and the integrated terminal running git](docs/screenshots/diff-terminal.png)

**Code files are code**, not markdown that happens to compile — syntax
highlighting for 143 languages, folding, bracket matching, multiple cursors,
column selection, and a minimap. Markdown's machinery is kept away from them,
because reading `[1, 2, 3]` in a JSON file as a link is not a small mistake.

![A TypeScript file with syntax highlighting, a minimap, code folding and git change bars in the gutter](docs/screenshots/code.png)

**Language servers** are used where you already have them installed: hover
types, completion, diagnostics in the gutter, and go-to-definition on `F12`.
None are bundled; a language without one still gets highlighting and folding.

**Git** is built in. Status, stage, unstage, discard, commit, a commit graph,
and change bars in the gutter. The diff opens as a tab with two real editors
side by side — highlighting, undo, multi-line selection — and the working-tree
side is editable and saves with `Ctrl+S`.

**A terminal** on ``Ctrl+` ``, running your own shell in the vault directory.

**Drawings** are a first-class file type: `.excalidraw` files open as an
Excalidraw canvas and are saved in Excalidraw's own format, so a board made here
opens on excalidraw.com and one made there opens here.

## Getting around

`Ctrl+P` opens any note by fuzzy name. `Ctrl+Shift+P` runs any of 52 commands.
In the same box, `:` jumps to a line and `@` jumps to a heading or a declaration
in the file you are looking at.

## AI, if you want it

Optional and off until configured. Point it at the Claude API or a local Ollama
model in **Settings → AI**. Answers are grounded in the note you have open plus
matching passages from the vault, cited as `[file:line]`, and semantic search
runs over locally computed embeddings. API keys stay in the main process and
never reach the renderer.

## Install

Prebuilt Linux packages (`.deb`, AppImage) are on the
[releases page](https://github.com/iskandarputra/orrery/releases). macOS and
Windows have to be built on those platforms for now.

### From source

```bash
git clone https://github.com/iskandarputra/orrery.git
cd orrery
./orrery.sh setup     # dependencies, Playwright browsers, Rust if present
./orrery.sh dev
```

`./orrery.sh` with no arguments lists everything it can do; `./orrery.sh doctor`
reports what is missing.

```bash
./orrery.sh check              # lint, typecheck, unit tests
ORRERY_XVFB=1 ./orrery.sh e2e  # the built app, driven by Playwright
./orrery.sh package            # .deb and AppImage into ./dist
```

Electron needs a display. Over SSH or in CI, `orrery.sh` runs the end-to-end
suite under `xvfb` on its own; `ORRERY_XVFB=1` forces that path on a desktop,
which is how you reproduce a CI failure locally.

> **Linux note.** If Electron aborts with a SUID sandbox error, either
> `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`,
> or run with `ELECTRON_DISABLE_SANDBOX=1`. Packaged builds are unaffected.

### The Rust sidecar (optional)

Vault-wide search has a Rust implementation in `native/`, spoken to over the
same framed JSON-RPC the app uses for language servers. On a 3,000-note vault it
answers in about 34 ms against roughly 543 ms for the TypeScript path.

It is entirely optional and off by default. Without a toolchain, without the
binary, or if it crashes, the TypeScript search runs and nothing else changes.

```bash
./orrery.sh native                 # build it
ORRERY_RUST_SEARCH=1 npm run dev   # use it
```

## Extending it

Commands, editor extensions and whole document surfaces are contributed through
one small API:

```ts
export const myPlugin: OrreryPlugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  activate(ctx) {
    ctx.registerCommand({ id: 'my.command', title: 'Do Thing', run: ({ store }) => … })
    ctx.addEditorExtension((settings) => myCodeMirrorExtension(settings))
    ctx.registerDocumentSurface({
      id: 'drawio',
      label: 'diagrams.net',
      claims: (name) => name.endsWith('.drawio'),
      Component: DrawioEditor
    })
  }
}
```

Wikilinks and the Excalidraw canvas are both built-ins written against exactly
this API, using nothing a third-party plugin could not. External plugins load
from `<userData>/plugins/*.js` at startup and call `orrery.register({...})`
against the same surface — trusted local code, in the Obsidian sense.

## How it is built

Electron · React 19 · TypeScript (strict) · CodeMirror 6 · Zustand · zod.

```
src/core/      pure logic — no Electron, no DOM, no editor. 34 modules, 34 tested
src/shared/    the IPC contract both processes compile against
src/main/      files, git, language servers, terminal, embeddings
src/preload/   the one bridge
src/renderer/  React, CodeMirror, the whole interface
```

Nothing points back up that list, and `src/architecture.test.ts` enforces it:
layer crossings and runtime import cycles fail the test rather than the app.
Document text lives in CodeMirror state rather than React, so no large string
travels through a re-render on a keystroke. Every IPC channel is declared once
and validated with zod at the boundary. Saves are atomic and check the file's
mtime, so a write cannot silently discard a change made outside the editor.

[ARCHITECTURE.md](ARCHITECTURE.md) is the fuller version: what the layers are,
where new code goes, and which rules are checked by a test rather than asked for
politely.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers running it and what the code expects.
Bug reports and pull requests are welcome.

## Licence

MIT — see [LICENSE](LICENSE).

Orrery bundles fonts and libraries under their own terms, all of them permissive
and none copyleft. [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists every
one with its copyright holder; the full texts are in [`licenses/`](licenses/).

Inspired by [MarkText](https://github.com/marktext/marktext), and by Obsidian's
idea that a folder of plain files is a good enough database.
