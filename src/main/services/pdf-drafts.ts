/**
 * A PDF as the app currently shows it, before anybody has asked to save it.
 *
 * Every other edit in Orrery is pending until Ctrl+S: a note lives in its
 * buffer, an annotation lives in pdf.js's storage, and the file on disk is what
 * you last chose to write. Editing the page itself did not work that way —
 * dragging a word, or putting a picture down, rewrote the document immediately
 * — so a document opened to read could be changed by a stray drag, with no dot
 * on the tab to say so and nothing but an in-memory undo stack to get back.
 *
 * A draft closes that gap. The engine still rewrites the whole document for
 * every change, because that is what PDFium does; the difference is where the
 * bytes go. They come here, the reader is pointed at them instead of at the
 * file, and the file is only touched when somebody saves.
 *
 * Held in memory rather than in a temp file. The reader streams the draft over
 * the asset protocol, and a file it was part-way through reading would have to
 * outlive being replaced by the next edit — an open handle on Linux, a locked
 * file on Windows. Bytes have no such lifetime. The cost is one copy of the
 * document per PDF being edited, which is the same order as what pdf.js is
 * already holding to draw it, and it goes as soon as the document is saved.
 */
export class PdfDrafts {
  private readonly drafts = new Map<string, Uint8Array>()

  /** Whether this document has changes that are not on disk. */
  has(path: string): boolean {
    return this.drafts.has(path)
  }

  /** The draft's bytes, for the protocol handler serving them to the reader. */
  peek(path: string): Uint8Array | undefined {
    return this.drafts.get(path)
  }

  /**
   * The document as it currently stands: the draft if there is one, else the
   * file. Every edit reads through this, so a second change lands on top of the
   * first rather than on top of what was last saved.
   */
  async read(path: string, fromDisk: (path: string) => Promise<Uint8Array>): Promise<Uint8Array> {
    const draft = this.drafts.get(path)
    return draft ?? (await fromDisk(path))
  }

  /** Record what the document now says. */
  set(path: string, bytes: Uint8Array): void {
    this.drafts.set(path, bytes)
  }

  /**
   * Throw the draft away — because it has just been written to disk, or because
   * the tab was closed without saving it.
   */
  discard(path: string): void {
    this.drafts.delete(path)
  }
}
