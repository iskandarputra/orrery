<p align="center">
  <img src="docs/logo.png" alt="" width="96" height="96">
</p>

<h1 align="center">Orrery</h1>

<p align="center">
  A desktop markdown editor and knowledge base, with a real code editor, git and a terminal built in.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F.svg">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <a href="https://github.com/iskandarputra/orrery/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/iskandarputra/orrery/actions/workflows/ci.yml/badge.svg"></a>
</p>

Point Orrery at a folder. Your notes stay ordinary markdown files on disk,
joined by `[[wikilinks]]`, and Orrery reads the whole folder. The structure you
have built becomes something you can see, search and walk through.

That folder usually holds code as well as notes. So Orrery edits code properly,
shows you git diffs, and gives you a shell in the same window.

![The editor: live preview of headings, wikilinks, a table, a highlight and KaTeX maths](docs/screenshots/editor.png)

**Why you might want it.** Note apps tend to stop at notes. Code editors tend
to treat links between documents as text. Orrery does both jobs, because in
practice a folder of notes and a folder of code are the same folder.

**Why you might not.** It is two weeks old: version 0.1.0, one developer,
Linux packages only. The parts that could lose your work are covered by atomic
writes, conflict detection on save, and 1,495 unit and 434 end-to-end tests.
Everything else is early software that has been used in anger by exactly one
person. Keep your vault in git, which you should be doing anyway, and which
Orrery will now help you with.

## Writing

You are always editing real markdown. Formatting renders inline as you type:
headings size up, bold is bold, links show their label. The syntax markers
reappear exactly where the cursor lands. Nothing is converted to and from a
rich-text model, so the file on disk is what you typed.

Three modes on `Ctrl+Shift+1/2/3`: **Edit** (raw source), **Hybrid** (the
default), **Reading** (fully rendered, read-only).

Tables render as tables, and tidy themselves: edit one and the pipes line up
when you leave it, keeping whatever alignment the columns declared. A table you
only read is left exactly as it was. Drag the line between two columns in the
rendered table to set their widths, and double-click it to give the widths back
to the content. Markdown has nowhere to store a width, so that is a way of
looking at the table rather than a change to the file. `$inline$` and `$$block$$` maths through KaTeX.
` ```mermaid ` fences become diagrams. `==Highlights==` get a marker pen. Images
and diagrams open full screen. A long code fence scrolls inside its own card,
leaving the rest of the document where it was.

![Reading mode: a displayed equation, a mermaid flowchart and a TypeScript code card, with the outline panel listing the note's headings](docs/screenshots/reading.png)

**Raw HTML renders too**, which markdown files are full of: the centred title,
the row of badges and the `<details>` fold that every README opens with. It goes
through an allow-list, so a note can lay itself out and cannot run anything. A
tag that is refused is named where it was rather than vanishing.

YAML frontmatter renders as a **properties table** you edit in place. Add a
property, rename one, type a value, and the YAML underneath is rewritten.
Properties you did not touch are written back exactly as you left them, quoting
and all, so an editor that understands three kinds of value cannot reformat the
rest of your file.

**Footnotes** render as small raised markers. Click one and the cursor lands on
its definition.

**Vim keys**, if you want them: one toggle in **Settings → Editor**, applying to
prose and code alike.

**28 themes**, 17 dark and 11 light. Each is a six-line palette from which the
full token set is derived. A test checks every one of them for WCAG AA contrast
and pointer target size on every change, so an unreadable theme fails the build.

## Finding your way around a vault

`[[Wikilinks]]` connect notes by name: `[[Note]]`, `[[Note#Heading]]`,
`[[Note|alias]]`. Typing `[[` completes from the vault index and `Ctrl+click`
follows a link. Follow one to a note you have never written and Orrery creates
it. Links inside code fences stay as text, since a snippet showing the syntax is
documentation rather than a reference.

**Backlinks** (`Ctrl+Shift+B`) list every note pointing at this one, and every
importing source file too when the include-code graph setting is on, with the
line each mention sits on. **Outgoing links** does the reverse, and names the
links that lead nowhere yet, which is usually where the next note comes from.
**Bookmarks** keeps the files you return to. **Tags**, an **outline** and
per-note **analysis** each get a panel of their own.

Hovering a wikilink shows the note it points at, rendered, without leaving the
one you are reading.

**Search** covers every text file in the vault, code included. Match case,
whole word, regular expressions, and comma-separated globs for which files to
include and exclude: `*.md`, `src/**`, `**/*.test.ts`. Operators do the same
work from the search box: `path:src/` and `file:*.ts` narrow it, `tag:draft`
looks for a tag, and a leading `-` excludes. Orrery decides a file is binary by
looking inside it, so an unfamiliar extension still gets searched.

![The knowledge graph: 28 notes in four clusters, joined by 71 links](docs/screenshots/graph.png)

The **graph** (`Ctrl+Shift+G`) draws the whole vault as a map you can drag and
zoom. Hover a note to spotlight what it connects to, click to open it. Size the
nodes by links, influence or bridging; colour them by cluster or folder; narrow
the view to whatever sits within _n_ hops of the note you are reading. A note
you have linked to but never written appears as a ghost, so the gaps show up
alongside the structure.

**Code is on the map too.** A vault is a folder, and a folder with source in it
has two kinds of link: notes point at each other with wikilinks, files point at
each other with imports. Both are drawn, and a note that links `[[pane]]`
reaches `pane.ts`, so the writing and the code are one shape rather than two.
Imports are read from the file for the usual languages, and only ever resolved
to files inside the vault: a dependency on `react` is real but it is not part of
this folder. Colour by "Notes or code" to tell them apart, or switch code off in
the graph's own settings.

`Ctrl+P` opens any note by fuzzy name, `Ctrl+Shift+R` reopens something you had
open before, and `Ctrl+Shift+P` runs any of 75 commands. In the same box, `:`
jumps to a line and `@` jumps to a heading or a declaration inside the file you
are looking at. Prompts from connected MCP servers are in there too, since a
prompt is a command someone else wrote. Two of those commands are for when you
do not know what to open: one picks a note at random, the other makes a new one
named after the minute you thought of it.

**Up to four panes** side by side. `Ctrl+\` splits, `Ctrl+Shift+\` sends the
tab you are on into a pane of its own, `Ctrl+Alt+\` moves between them, and no
file is ever open in two panes at once. To open a file beside what you are
reading rather than over it, right-click it in the tree and choose **Open to the
Side**, or press `Ctrl+Enter` in quick open. Drag the divider between two panes
to set their widths, double-click it to even them out, or use
`Ctrl+Alt+←` and `Ctrl+Alt+→`.

A layout worth keeping becomes a **workspace**: `Ctrl+Alt+W`, give it a name,
and the tabs, panes, column widths and side panel come back that way whenever
you ask for it.

`Ctrl +` and `Ctrl -` zoom the whole interface in Chromium's 1.2x steps, `Ctrl
0` puts it back, and the level is remembered across a restart. Add `Shift` and
only the document scales, leaving the sidebar and tabs where they are. The
editor, a diff, a table, a database and a rendered page all follow it.

## Code, git and a terminal

![A side-by-side diff with a minimap, the source control panel, and the terminal running git](docs/screenshots/diff-terminal.png)

**Git is built in.** Status, stage, unstage, discard, commit, and change bars in
the editor gutter. A diff opens as a tab holding two real editors side by side,
with syntax highlighting, undo and selection across lines. The working-tree side
is editable and saves with `Ctrl+S`. Drag the line between the two columns to
give one of them more room, and double-click it to even them up again. The
minimap marks what changed as bands across its whole width rather than a sliver
down one edge, so a small edit in a long file is visible from the other side of
the room.

**The commit graph** draws every branch. Hover a commit for its full message,
author and hash. Click it to see which files it touched, and click a file to
open that commit's diff against its parent. Right-click for the rest: copy the
hash or the message, check the commit out, start a branch from it, revert it, or
cherry-pick it onto the branch you are on.

**A terminal** on ``Ctrl+` ``, running your own shell in the vault directory.

![A TypeScript file with syntax highlighting, a minimap, folding and git change bars](docs/screenshots/code.png)

**Code files are treated as code.** Highlighting for 143 languages, folding,
bracket matching, multiple cursors, column selection and a minimap. Markdown's
machinery stays well away from them: read `[1, 2, 3]` in a JSON file as a link
and you have silently changed what the file appears to say.

**Language servers** are used where you already have them installed: hover
types, completion, diagnostics in the gutter, go-to-definition on `F12`. Orrery
bundles none of them, and a language without one still gets highlighting and
folding.

**Pictures open as pictures.** A `.png`, `.jpg`, `.gif`, `.webp`, `.bmp`,
`.avif` or `.ico` opens in a viewer: fit to the window or at its own size, zoom
with the buttons or `Ctrl` and the wheel, and the dimensions in the bar, because
"is this the big one or the thumbnail" is the question people actually have.
Transparency reads as transparency over a chequerboard. The file is never
written back, so no save can put text where a picture was. An `.svg` still opens
as text, because it is also a file you edit.

**Drawings** are a first-class file type. `.excalidraw` files open as an
Excalidraw canvas and save in Excalidraw's own format, so a board made here
opens on excalidraw.com and one made there opens here.

**Web pages, read or edited.** A `.html` file opens as source, highlighted, and
the **Read** switch in the header renders it, with `Ctrl+Shift+V` or **View →
View Mode → Toggle HTML Preview**. It renders what is in the buffer rather
than what is on disk, so an edit shows without a save, and switching back finds the same
document with its cursor and undo history intact. Reading is remembered per
file: turning it on for one page does not change how the next one opens, and it
does not touch the view mode notes use.

The page is somebody else's document, so it is treated as one. It renders in a
sandboxed frame under a policy that starts by refusing everything, and each
thing it might want is a decision you make rather than one already made for
you.

Its own stylesheet, pictures and fonts load from the folder the file sits in,
and only from there, over a scheme that resolves a path against that one folder
in the main process, so a page asking for `~/.ssh/id_rsa` gets nothing. Nothing
loads from the internet until you press the button that says how many things
are waiting. The page's own code does not run until you press the other one,
and the bar says so rather than letting you wonder. Code fetched from the
internet never runs, at any setting: loading a picture from someone's server
tells them you opened their file, and running their code hands them the page
you are reading, which is not the same decision.

Saying yes once is enough. The answer is kept against the file and against the
bytes it had at the time, so a page you come back to opens the way you left it,
and a file whose contents have been swapped underneath the same name asks again.
The bar's notice that the page is running is also the way to take that back.
If you would rather never be asked, **Settings → General → Run scripts in HTML
files** answers it once for every local page. It is off to begin with, and it
changes nothing about the internet: remote content is still a decision per file,
and remote code still never runs.

Two things it draws that a browser would need the page's scripts for: a
` ```mermaid ` block becomes a diagram and TeX becomes typeset maths, both
rendered by Orrery from the page's own source. The bar counts them.

It is not a browser and does not pretend to be, so there is a **Browser**
button that hands the file to yours. What you lose on the way there is listed
in [SECURITY.md](SECURITY.md).

![An HTML file being read: the bar says one diagram drawn and two equations typeset, and offers to run the page's scripts or load its one remote item](docs/screenshots/html.png)

**Tables and databases.** A `.csv` opens as a grid you can sort, filter, resize
and rearrange by dragging, edited in place. Sorting and filtering never touch
the file: they choose an order to draw in, and an edit goes back to the row it
really came from.

![A CSV open as a grid of ten rows and five columns, with a filter box and buttons to add a row or a column](docs/screenshots/csv.png)
A `.db` or `.sqlite` opens as its tables, with row counts, a
page at a time, sortable, and a box for a query.

![A SQLite file open as its tables: two of them listed with row counts, one shown as a grid, marked read-only](docs/screenshots/database.png)
It is strictly read-only, twice
over: the file is opened read-only and anything that is not a question is
refused before it reaches the database.

## AI, if you want it

Off until you configure it. Point it at the Claude API or a local Ollama model
in **Settings → AI**. Answers are grounded in the note you have open plus
matching passages from the vault, each cited as `[file:line]`. Semantic search
runs over embeddings computed on your own machine. API keys stay in the main
process and never reach the renderer.

## PDFs, read and edited

![A PDF open as a document: its own sidebar showing the outline, with the page toolbar above and the first page rendered](docs/screenshots/pdf.png)

A PDF opens as a document rather than as bytes: pages, selectable text, find,
an outline, thumbnails. Vault search reads _inside_ them, `[[paper.pdf#page=12]]`
opens at that page, and a selection becomes a quotation in a note beside the
paper with a link back. Scanned pages can be recognised on your machine.

You can also change one. Highlight, draw, type, sign and fill a form; rearrange,
remove, turn and extract pages; put a picture on a page; or edit the page
itself: click a line and retype it in the document's own font, drag it somewhere else,
resize it, turn it about its own middle, write a new line where there was none,
or take something out of the file rather than covering it. `Ctrl+Z` takes back anything on that list,
including a rearrangement.

Two limits are stated plainly rather than discovered: there is no paragraph
reflow, and a font that never contained a character probably cannot draw it.
The editor says so before you commit, and takes a second `Enter` as your answer.
Full details in [docs/pdf.md](docs/pdf.md).

## MCP, both ways

Orrery speaks the Model Context Protocol in both directions. Full details in
[docs/mcp.md](docs/mcp.md).

**It connects to your MCP servers.** Paste the `mcpServers` block you already
use in Claude Desktop, Claude Code or VS Code, and their tools, resources and
prompts appear in the Tools panel, in the command palette, and to the
assistant. Any tool can be filled in and run by hand, which is how you find out
what one does before letting a model call it.

Every tool asks the first time, showing the server, the tool and the exact
arguments. The answer is remembered per tool, except for two things that always
ask: anything the server marks destructive, and anything that writes to your
vault. Refusing once refuses that call; refusing for good is its own button.
Every call is logged, including the refused ones.

Servers can ask Orrery for things too, and it answers: **sampling** runs through
your own configured model after showing you the prompt, **elicitation** draws a
form from the schema a server sends, and **roots** tells a server that the vault
is the one folder it may work in.

**It serves your vault.** Switch it on and Claude Code, Claude Desktop or
anything else that speaks MCP can search your notes, read them, follow backlinks
and read the git log. It listens on `127.0.0.1` behind a bearer token, and ships
a dependency-free stdio bridge for clients that launch a program instead. Every
path is checked against the vault, so one that climbs out with `..` is refused.
Writing is off inside all of that, and when it is on, each write asks you first
and shows what it is about to write.

## Install

Linux packages (`.deb`, AppImage) are on the
[releases page](https://github.com/iskandarputra/orrery/releases). The build
config has macOS and Windows targets, but they have to be built on those
platforms and so far nobody has.

### From source

```bash
git clone https://github.com/iskandarputra/orrery.git
cd orrery
./orrery.sh setup     # dependencies, Playwright browsers, Rust if present
./orrery.sh dev
```

`./orrery.sh` with no arguments lists everything it can do, and
`./orrery.sh doctor` reports what is missing.

```bash
./orrery.sh check     # lint, typecheck, unit tests
./orrery.sh e2e       # the built app, driven by Playwright
./orrery.sh package   # .deb and AppImage into ./dist
```

Electron opens real windows, so the end-to-end suite runs on a virtual display
and never takes your focus. Set `ORRERY_HEADED=1` when watching it is the point.

> **Linux note.** If Electron aborts with a SUID sandbox error, either
> `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`,
> or run with `ELECTRON_DISABLE_SANDBOX=1`. Packaged builds are unaffected.

### The Rust sidecar (optional)

Vault-wide search has a second implementation in Rust, in `native/`, spoken to
over the same framed JSON-RPC the app uses for language servers. On a 3,000-note
vault it answers in about 34 ms against roughly 543 ms for the TypeScript path.

It is optional and off by default. Missing toolchain, missing binary, or a
crash mid-query: the TypeScript search runs and nothing else changes. A
differential test holds the two implementations to each other, so they cannot
drift apart unnoticed.

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
this API, using only what a third-party plugin can reach. External plugins load
from `<userData>/plugins/*.js` at startup and call `orrery.register({...})`.
Trusted local code, in the Obsidian sense.

## How it is built

Electron · React 19 · TypeScript (strict) · CodeMirror 6 · Zustand · zod.

```
src/core/      pure logic. No Electron, no DOM, no editor. 61 modules, 61 tested
src/shared/    the IPC contract both processes compile against
src/main/      files, git, language servers, terminal, embeddings
src/preload/   the one bridge
src/renderer/  React, CodeMirror, the interface
```

Nothing points back up that list, and `src/architecture.test.ts` enforces it: a
layer crossing or a runtime import cycle turns a test red. Document text lives
in CodeMirror state, so no large string travels through a React re-render on a
keystroke. Every IPC channel is declared once and validated with zod at the
boundary. Saves go through a temporary file and check the mtime first, so a
write cannot silently discard a change made outside the editor. A note you have
written but not yet given a file is kept in the application's data folder and
comes back with the app, so quitting is never a decision about it. The question
is asked when you close the note, not when you close Orrery.

[ARCHITECTURE.md](ARCHITECTURE.md) is the longer version: what the layers are,
where new code goes, and which rules a test will hold you to.
[SECURITY.md](SECURITY.md) says which parts of a vault are trusted, which are
not, and how to report something privately.

## Contributing

Bug reports and pull requests are welcome. It is early enough that most things
are still easy to change. [CONTRIBUTING.md](CONTRIBUTING.md) covers running it
and what the code expects of you.

## Licence

MIT. See [LICENSE](LICENSE).

Orrery bundles fonts and libraries under their own terms, all of them permissive
and none copyleft. [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists every
one with its copyright holder, and the full texts are in
[`licenses/`](licenses/).

## About the name

An orrery is a clockwork model of a solar system: a machine that shows how the
planets move and what they pull on.

Inspired by [MarkText](https://github.com/marktext/marktext), and by Obsidian's
idea that a folder of plain files is a good enough database.
