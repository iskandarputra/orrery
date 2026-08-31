/**
 * How a PDF tab saves itself.
 *
 * The buffer behind a PDF is empty — the surface reads the file directly — so
 * the ordinary save path, which writes the buffer's document, would put nought
 * bytes over somebody's document. The surface therefore registers what to do,
 * and the open reader is the only thing that knows: the annotations and form
 * values live in pdf.js's storage, and only it can serialise them.
 *
 * A map rather than a single slot: two panes can show two different PDFs, and
 * Ctrl+S has to save the one that is focused.
 */

type Saver = () => Promise<boolean>

const savers = new Map<string, Saver>()
const undoers = new Map<string, { undo: Saver; redo: Saver }>()

/** The open reader for this tab announces itself; unmounting clears it. */
export function registerSaver(bufferId: string, save: Saver | null): void {
  if (save) savers.set(bufferId, save)
  else savers.delete(bufferId)
}

/**
 * Save the document in this tab.
 *
 * True when there was nothing to save as well as when the save worked: the
 * caller is asking "is this tab settled", and a document nobody has changed
 * already is.
 */
export async function savePdf(bufferId: string): Promise<boolean> {
  const save = savers.get(bufferId)
  if (!save) return true
  return save()
}

/**
 * The open reader also owns stepping the document back and forward.
 *
 * Undo for a PDF is not a stack of edits in memory — every change rewrites the
 * file — so it is the reader that knows which document is being stepped and
 * what to do with the bytes that come back.
 */
export function registerUndo(
  bufferId: string,
  handlers: { undo: Saver; redo: Saver } | null
): void {
  if (handlers) undoers.set(bufferId, handlers)
  else undoers.delete(bufferId)
}

/** False when this tab has nothing to undo, so the keystroke can go elsewhere. */
export async function undoPdf(bufferId: string): Promise<boolean> {
  const handlers = undoers.get(bufferId)
  return handlers ? handlers.undo() : false
}

export async function redoPdf(bufferId: string): Promise<boolean> {
  const handlers = undoers.get(bufferId)
  return handlers ? handlers.redo() : false
}
