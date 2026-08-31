import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * What a PDF looked like before each change, so a change can be taken back.
 *
 * A text editor's undo is a stack of edits to a string held in memory. A PDF's
 * cannot be: every change here is carried out by an engine that rewrites the
 * whole file, and the only honest record of "before" is the bytes that were
 * there. So this keeps them — on disk, because a scanned document is tens of
 * megabytes and twenty of those in memory is a quarter of a gigabyte for a
 * feature nobody thinks about until they need it.
 *
 * Bounded twice over: by how many steps are kept and by how much they weigh,
 * because a large document reaches the second limit long before the first.
 * Falling off the end of the history is the price of not filling somebody's
 * disk, and it is the same bargain every editor makes.
 *
 * Everything is best-effort. A history that cannot be written costs an undo; it
 * must never cost the save that was being made.
 */

/** Steps kept per document. Enough to get out of trouble, not a version store. */
const MAX_STEPS = 20

/** And no more than this in total per document, whatever that is in steps. */
const MAX_BYTES = 256 * 1024 * 1024

interface Step {
  /** Where the bytes are kept. */
  file: string
  /** Ordering: higher is more recent. */
  at: number
  bytes: number
}

export class PdfHistory {
  /** Undo and redo stacks per document, oldest first. */
  private readonly past = new Map<string, Step[]>()
  private readonly future = new Map<string, Step[]>()
  private counter = 0

  constructor(private readonly dir: string) {}

  /**
   * Keep what the document looks like now, before something changes it.
   *
   * Anything that was undone is dropped: once you make a new change, the branch
   * you had undone your way out of is not somewhere you can get back to, which
   * is what every undo stack does and what people expect.
   */
  async remember(filePath: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.clear(filePath, this.future)
      const step = await this.write(filePath, bytes)
      if (!step) return
      const stack = this.past.get(filePath) ?? []
      stack.push(step)
      await this.trim(stack)
      this.past.set(filePath, stack)
    } catch {
      // An undo that cannot be recorded is a lost undo, never a lost save.
    }
  }

  /** Whether there is anything to go back to, or forward to. */
  can(filePath: string): { undo: boolean; redo: boolean } {
    return {
      undo: (this.past.get(filePath)?.length ?? 0) > 0,
      redo: (this.future.get(filePath)?.length ?? 0) > 0
    }
  }

  /**
   * The bytes to go back to, given what the document says now.
   *
   * The caller does the writing: this only knows what the document was, and
   * hands the current state over to the other stack so the move can be reversed
   * again.
   */
  async undo(filePath: string, current: Uint8Array): Promise<Uint8Array | null> {
    return this.step(filePath, current, this.past, this.future)
  }

  async redo(filePath: string, current: Uint8Array): Promise<Uint8Array | null> {
    return this.step(filePath, current, this.future, this.past)
  }

  /** Forget a document's history — when its tab closes, or the vault changes. */
  async forget(filePath: string): Promise<void> {
    await this.clear(filePath, this.past)
    await this.clear(filePath, this.future)
  }

  private async step(
    filePath: string,
    current: Uint8Array,
    from: Map<string, Step[]>,
    to: Map<string, Step[]>
  ): Promise<Uint8Array | null> {
    const stack = from.get(filePath)
    const step = stack?.pop()
    if (!step) return null
    try {
      const bytes = new Uint8Array(await fs.readFile(step.file))
      const back = await this.write(filePath, current)
      if (back) {
        const other = to.get(filePath) ?? []
        other.push(back)
        await this.trim(other)
        to.set(filePath, other)
      }
      await fs.rm(step.file, { force: true })
      return bytes
    } catch {
      // The snapshot has gone; the step goes with it rather than pretending.
      return null
    }
  }

  private async write(filePath: string, bytes: Uint8Array): Promise<Step | null> {
    try {
      const dir = this.folderFor(filePath)
      await fs.mkdir(dir, { recursive: true })
      const at = ++this.counter
      const file = path.join(dir, `${at}.pdf`)
      await fs.writeFile(file, bytes)
      return { file, at, bytes: bytes.length }
    } catch {
      return null
    }
  }

  /** Drop the oldest steps until the stack is within both limits. */
  private async trim(stack: Step[]): Promise<void> {
    let total = stack.reduce((sum, step) => sum + step.bytes, 0)
    while (stack.length > MAX_STEPS || (stack.length > 1 && total > MAX_BYTES)) {
      const dropped = stack.shift()
      if (!dropped) break
      total -= dropped.bytes
      await fs.rm(dropped.file, { force: true }).catch(() => undefined)
    }
  }

  private async clear(filePath: string, stacks: Map<string, Step[]>): Promise<void> {
    for (const step of stacks.get(filePath) ?? []) {
      await fs.rm(step.file, { force: true }).catch(() => undefined)
    }
    stacks.delete(filePath)
  }

  private folderFor(filePath: string): string {
    return path.join(this.dir, createHash('sha256').update(filePath).digest('hex').slice(0, 16))
  }
}
