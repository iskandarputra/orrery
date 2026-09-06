# PDFs in Orrery

A PDF opens as a document, not as a wall of bytes: pages you can read, text you
can select and search, marks you can make, and, when you need it, the words on
the page themselves.

## Reading

Open any `.pdf` from the file tree. You get continuous scrolling, zoom (buttons,
fit width, fit page, actual size), rotation, a page box, the document's own
outline, and a rail of thumbnails. Where you were in a file is remembered for as
long as the app is running.

The text is real text: select it, copy it, search it with the toolbar's find,
which reports how many matches there are and marks them on the page.

Turning the pages turns them for looking at, not on disk. The page organiser
does the permanent kind. The turn is remembered along with the page and the
zoom, and it survives an edit: handing the viewer a rewritten document would
otherwise spring the pages upright underneath you.

## PDFs in the vault

This is what makes a PDF part of a knowledge base rather than a file beside one.

- **Vault search reads inside them.** A word that exists only in a paper is
  found, with the page it is on; the result opens the reader at that page. Text
  is extracted once and cached, so searching a folder of papers is not a folder
  of papers being parsed again.
- **Links can point at a page.** `[[paper.pdf#page=12]]` opens the document
  there, using the same `#page=` fragment every PDF viewer and browser
  understands.
  `[[paper.pdf]]` on its own opens the file.
- **Quote to a note.** Select something and press the quote button: it becomes a
  blockquote in a note named after the paper, beside it, with a link back to the
  page. The line breaks a column put in are joined back into prose.
- **Scans can be recognised.** A page with no text on it is a picture of
  writing. The reader offers to read it, and once it has, that page is
  searchable and quotable like any other. Recognition happens on your machine;
  the engine and its English data ship with the app.

## Marking up

Three tools: highlight, text box and draw. Form fields can be filled in.

There is no signature tool. pdf.js has the mode, and it switches on, but it
asks a signature manager for the signature itself and that manager is part of
pdf.js's own viewer rather than of the library. Wired to nothing, the button
lit up and did nothing at all, so it is gone until the dialog behind it exists.
Draw is how a signature gets made in the meantime. The rail's **Notes** tab lists every mark in the document with the page it
is on, in reading order.

**Image** sits beside them but is not one of them: it puts a real picture into
the page, not an annotation on top of it. Pick a file and it lands in the middle
of the page you are on, and the page editor opens with it, already holding the
picture, so its handles are there to drag, resize and turn straight away. Every
reader draws it, because it is part of the document rather than a note attached
to one.

Saving writes an _incremental update_: the original bytes are kept and the new
objects appended, so what lands on disk is the document you were sent plus what
you added, and any other PDF reader can open both. Ctrl+S saves, the tab carries
a dirty dot, and closing an unsaved document asks first.

## Nothing is written until you save it

Every change described below, whether marking up, filling a form, rearranging
pages or editing the page itself, changes the document Orrery is showing you,
not the file. Ctrl+S is what writes, the tab carries a dirty dot until it does, and
closing without saving throws the changes away and leaves the file as it was.

This is worth stating plainly because it did not used to be true of one half of
it. Editing the page itself wrote to disk the moment you did anything: a picture
placed to see how it looked was already in your document, a word dragged by
accident was saved before you noticed, and the tab said "Saved" throughout. The
only way back was an undo stack that did not survive closing the tab.

The unsaved document lives in the main process, and the reader is served it in
place of the file, so what you see is what you have done. Two panes onto the
same PDF share it and both carry the dot. The one exception is **Extract**,
which makes a new file rather than changing this one; it writes what you can
see, unsaved changes included.

## Undo

Ctrl+Z takes back the last change, Ctrl+Shift+Z makes it again, and the toolbar
has both. It covers everything that changes the document: retyping, moving,
removing, adding, and rearranging pages.

A PDF's undo cannot be a stack of edits held in memory, because the engine
rewrites the whole document for every change: what is kept is what the bytes
were, on disk, under `pdf-undo` in the application's data folder. Twenty steps
per document, and no more than 256 MB of them, because a scanned document
reaches the second limit long before the first. Closing the tab throws them
away.

Stepping back changes the document, not the file. Taking back a change that was
never written is not a reason to write one. Undoing past your last save leaves
the tab with something to save again, which is exactly what it has.

## Organising pages

The **Pages** tab is a page organiser. Select pages and turn, move, remove or
extract them, drag a thumbnail to reorder it, or add another document's pages to
the end of this one. **Apply** carries the arrangement out on the document
(Ctrl+S is still what writes it), and **Undo** puts the arrangement back.
Extracting writes a new file beside the original and never overwrites an
existing one.

## Editing the page itself

**Edit the page itself** (the slider icon) is the difference between writing on
a document and changing it. Every line on the page gets a box; click one to
retype it in the document's own font at its own position, or to remove it from
the file.

A line, not a character. Most PDFs position every glyph separately for kerning.
One page of a real letter of offer held 4,662 text objects, one letter each, so
the characters are put back into lines before anything is shown. Retyping a line
replaces the run: the words are laid out by the font's own advances rather than
by the producer's per-character nudges, so a heavily kerned line may shift
slightly as it is rewritten.

Two limits are worth knowing before you rely on this, and the editor will tell
you about the second one itself:

- **There is no reflow.** A PDF has no paragraphs, only instructions to draw
  text at particular places. A longer line runs on past where the old one ended
  rather than pushing what follows down the page. Acrobat papers over this with
  heuristics and still gets it wrong; Orrery does not pretend to.
- **A font may not have the glyph.** Most documents embed only the characters
  they use, so typing one the document has never drawn may draw nothing at all.
  The editor checks what you type against everything the document says, names
  the characters it doubts, and takes a second Enter as your answer, because
  the font may well have them.

**Dragging** an object moves it: the same glyphs or picture, somewhere else on
the page. A picked object grows a handle at its corner, which resizes it in
place, and one above it, which turns it about its own middle; hold Shift while
turning to move in fifteen-degree steps. All three work on a page you have
turned: the boxes are placed on the page as drawn rather than as stored, so what
you click is what you get whichever way up it is.

Turning applies to anything on the page, a line of text included. The engine
has no notion of an object's current angle, only of a matrix applied to it, so
every turn is relative to wherever the thing already sits. **Double-clicking empty space** starts a new line of text, written in
Helvetica because a document's own fonts usually hold only the characters
already on the page; new words in one of those would come out full of holes.
Text does not wrap, so a line started near the edge runs off it.

**Removing takes something out of the file**, rather than covering it. That is
the difference between redaction and a black rectangle: a covered word is still
in the document for anyone who selects the text or reads the bytes.

## What Orrery will not do

- Convert a PDF to Word or Excel.
- Sign a document with a certificate, or check somebody else's signature. Nor
  is there a signature tool for the drawn kind yet; see **Marking up** above.
- Run JavaScript that a PDF carries. This is deliberate: a document you were
  sent is not a place to execute code from. Forms still fill in; only their
  scripting is absent.
- Reach the network. Everything above happens on your machine.

## For maintainers

| Piece                              | Where                                   | Why there                                                      |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Rendering, text, find, annotations | renderer, `plugins/pdf/`                | pdf.js owns the drawing and every interaction                  |
| Text extraction and its cache      | main, `services/pdf-text.ts`            | search runs in main, over every PDF in a vault                 |
| Pages, and editing objects         | main, `services/pdfium.ts`              | pdf.js reads and appends; taking a document apart needs PDFium |
| Deciding _what_ to change          | `core/pdf-pages.ts`, `core/pdf-edit.ts` | pure, and tested without an engine anywhere near it            |
| Page coordinates, at any rotation  | `core/pdf-geometry.ts`                  | one place for maths that nine call sites used to do inline     |

Every write is read back with the _other_ engine in the tests: PDFium writes and
pdf.js reads, and they share no code. Two independent implementations agreeing
is the strongest cheap guarantee available for a format this fiddly. The same
trick covers the geometry: `core/pdf-geometry.ts` is checked at all four
rotations against pdf.js's own `convertToViewportPoint`, so the boxes the editor
draws are placed by the transform pdf.js drew the pixels with rather than by a
second opinion about what that transform is.

That module exists because rotation and object editing were built without
knowing about each other. Turned a quarter, the drawn page's width is the page's
_height_, so the scale was measured against the wrong side and every box was
placed along the wrong axis. Since a click picks whatever box is under it,
clicking a word retyped a different one. Worth remembering as the shape of the
next bug in this area: a PDF editor's failures are usually silent and land in
somebody's document.

The engines and their data are copied beside `index.html` by
`scripts/sync-assets.mjs`, and the packaged application leaves the original
packages out of the archive. See the `files` list in `electron-builder.yml`,
and `e2e/packaged-pdf.spec.ts`, which opens, recognises and rearranges a PDF in
the packaged build because that is the only place getting it wrong shows up.
