# Orrery

An orrery is a clockwork model of a solar system: it does not just hold the
bodies, it shows how they move and what they pull on.

A markdown editor and knowledge base built the same way — your notes are the
bodies, and the links between them are modelled, measured and shown back to
you. Inspired by [MarkText](https://github.com/marktext/marktext), rebuilt on a
modern, testable architecture.

**Stack:** Electron · React 19 · TypeScript (strict) · CodeMirror 6 · Zustand · zod

**Contributing?** [ARCHITECTURE.md](ARCHITECTURE.md) is the short version: what the layers are, where new code goes, and which rules are enforced by a test rather than by convention.

## The editing experience

orrery uses a **live-preview hybrid** (Typora/Obsidian style): you always edit real markdown source, but formatting renders inline — headings size up, bold is bold, links show their label, task checkboxes are clickable — and syntax markers reappear precisely where your cursor is. The document is never converted to and from a rich-text model, so what's on disk is exactly what you wrote.

**Three view modes** — a switch in the status bar (or Ctrl+Shift+1/2/3, Ctrl+/ to cycle): **Edit** (raw markdown source), **Hybrid** (live preview — the default), and **Reading** (fully rendered, read-only). **Reflow paragraphs** (on by default) joins soft-wrapped source lines to fill the canvas like a markdown preview, leaving your file's line breaks untouched. Typography is bundled (Inter, JetBrains Mono, Newsreader) so it's identical on every machine.

**Settings** (Ctrl+,) cover General (autosave, startup), Editor (typography, wrap, line numbers), Markdown (live-preview toggles), Appearance, and Keybindings. **28 built-in themes** (17 dark, 11 light — Dracula, Nord, Catppuccin, Gruvbox, Tokyo Night, Rosé Pine, Solarized and more) are defined as small palettes in `src/renderer/src/themes/themes.ts`; the full token set per theme is derived at startup, so adding a theme is ~6 lines.

## Knowledge base

orrery treats a folder as a vault, Obsidian-style:

- **`[[Wikilinks]]`** — link notes by name (`[[Note]]`, `[[Note#Heading]]`, `[[Note|alias]]`). Rendered inline with syntax concealed, `[[` triggers note-name autocomplete from the workspace index, Ctrl+click navigates — and creates the note if it doesn't exist yet. Links to missing notes get a dashed style.
- **Backlinks panel** (Ctrl+Shift+B) — see every note that references the one you're editing, grouped by file with line snippets.
- **Context menus everywhere** — tabs (close / close others / close to the right / close all, copy path, reveal in file manager) and the file tree (new file/folder, inline rename, delete to trash, copy path, reveal).

## Plugins

Features beyond the core are built against a small plugin API (`src/renderer/src/plugins/api.ts`):

```ts
export const myPlugin: OrreryPlugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  activate(ctx) {
    ctx.registerCommand({ id: 'my.command', title: 'Do Thing', run: ({ store }) => … })
    ctx.addEditorExtension((settings) => myCodeMirrorExtension(settings))
  }
}
```

Wikilinks itself is a built-in plugin (`plugins/wikilinks/`) — proof the extension points are real. **External plugins** load from `<userData>/plugins/*.js` at startup: each file receives a `orrery` object and calls `orrery.register({...})` against the same API (trusted local code, Obsidian-style).

## Rich rendering

Rendered inline, reverting to source when the cursor enters — the live-preview pattern applied everywhere:

- **Tables** render as real GitHub-styled tables (alignment, zebra rows, formatted cells).
- **Math** — `$inline$` and `$$block$$` via KaTeX.
- **Diagrams** — ` ```mermaid ` fences render as diagrams (mermaid lazy-loaded so startup stays fast), theme-aware.
- **Highlights** — `==marked text==` renders as a theme-tinted marker pen.

## More

- **Command palette** (Ctrl+Shift+P) fuzzy-runs any command; **Quick Open** (Ctrl+P) fuzzy-opens any note. Every plugin command appears automatically.
- **Outline / Global search** — the right panel tabs between Outline (TOC), Backlinks, Search (regex + case, whole vault), and **AI**.
- **AI chat** (Ctrl+Shift+A) — provider-agnostic (Claude API or a local Ollama model, configured in Settings → AI; keys stay in the main process and never touch the renderer). Answers are grounded in your active note plus matching vault snippets, cited as `[file:line]`.
- **Graph view** (Ctrl+Shift+G) — force-directed vault link graph on canvas: drag, zoom, hover to spotlight connections, click to open. Missing link targets show as ghost nodes.
- **Extract to Note** (Ctrl+Alt+N) — turn a selection into a new note, replacing it with a wikilink (Zettelkasten refactor).
- **Unwrap Paragraphs** — safely reflow hard-wrapped imported text (skips code, tables, lists, quotes).
- **Export** — standalone HTML (embedded GitHub-style CSS) or PDF (via Electron's print pipeline).
- **Custom keybindings** — override any shortcut in Settings → Keybindings; the native menu rebuilds live.

## Development

`./orrery.sh` is the entry point for everything; run it with no arguments for
the full list.

```bash
./orrery.sh setup    # system packages, node modules, and the Rust toolchain
./orrery.sh doctor   # report what is present and what is missing
./orrery.sh dev      # start with HMR
./orrery.sh check    # lint + typecheck + unit tests (what CI runs first)
./orrery.sh e2e      # build, then Playwright against the built app
```

The underlying npm scripts still work if you prefer them:

```bash
npm run dev
npm test           # unit tests (vitest)
npm run e2e        # build + Playwright e2e against the packaged app
npm run typecheck  # strict TS across main + renderer
npm run lint
```

Electron needs a display. Where there is none — over SSH, or in CI — `orrery.sh`
runs the e2e suite under `xvfb` automatically. Set `ORRERY_XVFB=1` to force that
path on a desktop, which is how you reproduce a CI failure locally.

> **Linux dev note:** if Electron aborts with a SUID sandbox error, either
> `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`
> or run dev with `ELECTRON_DISABLE_SANDBOX=1`. Packaged builds are unaffected.

## Building & packaging

```bash
./scripts/build.sh              # compile to ./out (typecheck + electron-vite)
./scripts/build.sh --fast       # skip typecheck

./scripts/package.sh            # Linux .deb + AppImage → ./dist
./scripts/package.sh deb        # only .deb
./scripts/package.sh appimage   # only AppImage
./scripts/package.sh --skip-checks   # skip lint/typecheck/tests

# equivalents also wired as npm scripts:
npm run dist        # → scripts/package.sh
npm run dist:deb    # → scripts/package.sh deb
```

### The Rust search sidecar (optional)

Vault-wide search has a Rust implementation in `native/`, spoken to over the
same framed JSON-RPC the app already uses for language servers. On a 3,000-note
vault it takes ~34ms against ~543ms for the TypeScript path.

It is entirely optional. Without a Rust toolchain, without the binary, or if it
crashes, `LinkScanner` runs its TypeScript search and nothing else changes.

```bash
./orrery.sh native      # build the sidecar
./orrery.sh e2e:rust    # run the e2e suite against it
ORRERY_RUST_SEARCH=1 npm run dev   # enable it in a dev run
```

It is off by default while it is being evaluated.

Artifacts land in `./dist` (e.g. `orrery_0.1.0_amd64.deb`, `orrery-0.1.0.AppImage`). The app icon lives at `build/icon.png`. macOS/Windows targets (`npm run package:mac` / `package:win`) must be built on the matching OS — cross-building from Linux isn't supported here.

## Architecture

```
src/
├── shared/     IPC contract + zod settings schema — the single source of truth
│               both processes compile against (ipc.ts, settings.ts, types.ts)
├── core/       Pure domain logic. No Electron, no React, no DOM. (paths, recent-list)
├── main/       Electron main process
│   ├── ipc/        typed handler registry: impossible to register a channel
│   │               that's not in the contract; zod-validates untrusted payloads
│   ├── services/   FileSystemService (atomic writes + mtime conflict detection),
│   │               WatcherService (chokidar, debounced batches), SettingsStore
│   │               (zod-validated JSON, corrupt file → defaults, never crashes)
│   ├── windows.ts  window factory/manager — security posture lives here only
│   └── menu.ts     declarative menu; items dispatch command ids, zero behavior
├── preload/    the one bridge (window.orrery) — thin, typed, whitelisted
└── renderer/
    └── src/
        ├── state/      Zustand slices: documents (tabs/buffers), workspace
        │               (tree + watching), ui (settings mirror)
        ├── commands/   command registry — menus, shortcuts and the future
        │               command palette are dispatchers over one behavior table
        ├── components/ React shell: Sidebar, FileTree, TabBar, StatusBar, EditorPane
        ├── editor/     CM6 engine
        │   └── live-preview/  one module per markdown feature (headings,
        │                      emphasis, links, lists, blockquote, hr, code)
        └── styles/     design tokens as CSS custom properties; one token set
                        drives both the shell and the editor theme (light/dark)
```

### Key decisions

- **Document text lives in CodeMirror state, not React state.** The store holds tab metadata only; background tabs keep detached `EditorState`s (undo history, selection and scroll survive tab switches for free). No large strings flow through React on keystrokes.
- **Typed IPC contract** (`src/shared/ipc.ts`): every channel's request/response type is declared once; preload, main handlers and the renderer client all type-check against it. Renderer payloads are zod-validated at the main boundary.
- **Hexagonal seams for testability**: the renderer talks to `services/client.ts` (swappable `OrreryApi` fake), so the whole open/save/close/dirty/conflict lifecycle unit-tests in Node without Electron. The live-preview decoration builder is a pure function over `(EditorState, ranges)` and is tested without a DOM view.
- **Safety**: atomic writes (temp + rename), optimistic-concurrency saves (external modification → conflict prompt), unsaved-changes interception on window close, `contextIsolation` + `sandbox` + CSP + deny-all navigation.

### Roadmap

Delivered: themes, live tables, math, mermaid, highlights, wikilinks, backlinks, graph view, command palette, quick open, global search, outline, atomic notes, export, plugins, custom keybindings, AI chat, **source-mode toggle**, **inline images** (via the sandboxed `orrery-asset://` protocol), **typewriter & focus modes**, **AI semantic search** (vault embeddings via a local Ollama model).

Still open (nice-to-haves): plugin marketplace, collaborative editing, mobile/web build.

## License

MIT
