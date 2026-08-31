# PDFs in Orrery

A PDF opens as a document, not as a wall of bytes: pages you can read, text you
can select and search, marks you can make, and — when you need it — the words on
the page themselves.

## Reading

Open any `.pdf` from the file tree. You get continuous scrolling, zoom (buttons,
fit width, fit page, actual size), rotation, a page box, the document's own
outline, and a rail of thumbnails. Where you were in a file is remembered for as
long as the app is running.

The text is real text: select it, copy it, search it with the toolbar's find,
which reports how many matches there are and marks them on the page.

## PDFs in the vault

This is what makes a PDF part of a knowledge base rather than a file beside one.

- **Vault search reads inside them.** A word that exists only in a paper is
  found, with the page it is on; the result opens the reader at that page. Text
  is extracted once and cached, so searching a folder of papers is not a folder
  of papers being parsed again.
- **Links can point at a page.** `[[paper.pdf#page=12]]` opens the document
  there — the same `#page=` fragment every PDF viewer and browser understands.
  `[[paper.pdf]]` on its own opens the file.
- **Quote to a note.** Select something and press the quote button: it becomes a
  blockquote in a note named after the paper, beside it, with a link back to the
  page. The line breaks a column put in are joined back into prose.
- **Scans can be recognised.** A page with no text on it is a picture of
  writing. The reader offers to read it, and once it has, that page is
  searchable and quotable like any other. Recognition happens on your machine;
  the engine and its English data ship with the app.

## Marking up

Five tools: highlight, text box, draw, image, signature. Form fields can be
filled in. The rail's **Notes** tab lists every mark in the document with the
page it is on, in reading order.

Saving writes an _incremental update_ — the original bytes are kept and the new
objects appended — so what lands on disk is the document you were sent plus what
you added, and any other PDF reader can open both. Ctrl+S saves, the tab carries
a dirty dot, and closing an unsaved document asks first.

## Organising pages

The **Pages** tab is a page organiser. Select pages and turn, move, remove or
extract them. Nothing is written until you press **Apply**; **Undo** puts the
arrangement back. Extracting writes a new file beside the original and never
overwrites an existing one.

## Editing the page itself

**Edit the page itself** (the slider icon) is the difference between writing on
a document and changing it. Every object drawn on the page gets a box; click one
to retype it in the document's own font at its own position, or to remove it
from the file.

Two limits are worth knowing before you rely on this, and the editor will tell
you about the second one itself:

- **There is no reflow.** A PDF has no paragraphs — only instructions to draw
  text at particular places. A longer line runs on past where the old one ended
  rather than pushing what follows down the page. Acrobat papers over this with
  heuristics and still gets it wrong; Orrery does not pretend to.
- **A font may not have the glyph.** Most documents embed only the characters
  they use, so typing one the document has never drawn may draw nothing at all.
  The editor checks what you type against everything the document says, names
  the characters it doubts, and takes a second Enter as your answer — because
  the font may well have them.

**Removing takes something out of the file**, rather than covering it. That is
the difference between redaction and a black rectangle: a covered word is still
in the document for anyone who selects the text or reads the bytes.

## What Orrery will not do

- Convert a PDF to Word or Excel.
- Sign a document with a certificate, or check somebody else's signature.
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

Every write is read back with the _other_ engine in the tests: PDFium writes and
pdf.js reads, and they share no code. Two independent implementations agreeing
is the strongest cheap guarantee available for a format this fiddly.

The engines and their data are copied beside `index.html` by
`scripts/sync-assets.mjs`, and the packaged application leaves the original
packages out of the archive — see the `files` list in `electron-builder.yml`,
and `e2e/packaged-pdf.spec.ts`, which opens, recognises and rearranges a PDF in
the packaged build because that is the only place getting it wrong shows up.
