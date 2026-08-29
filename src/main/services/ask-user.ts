import { randomUUID } from 'node:crypto'

/**
 * The one place the IPC direction inverts.
 *
 * Everything else in this app is the renderer asking main a question. MCP needs
 * the opposite: a tool call is halfway through, in main, and only the person at
 * the keyboard can say whether it may finish. Sampling and elicitation need the
 * same trick, so the mechanism is one module rather than three.
 *
 * The rule that makes it safe is that **every path settles, and every path that
 * is not an explicit yes settles as no**: no window, no answer in time, the
 * window closing, a second answer arriving late. A permission prompt that can
 * hang is a permission prompt that will eventually be bypassed by someone
 * restarting the app, and a pending promise in main holds the tool call open
 * against a server that is waiting on it.
 */

export type AskKind = 'tool' | 'elicitation' | 'sampling'

export interface AskRequest {
  id: string
  kind: AskKind
  /** Everything the dialog needs. Shape depends on `kind`; the renderer knows. */
  payload: unknown
}

/** Two minutes: long enough to read a tool's arguments, short enough to end. */
const DEFAULT_TIMEOUT_MS = 120_000

export class AskUser {
  private readonly pending = new Map<string, (value: unknown) => void>()

  /**
   * @param deliver puts the request in front of the user. `false` means there
   * is nobody there — no window, or one that is going away — which is a denial.
   */
  constructor(
    private readonly deliver: (request: AskRequest) => boolean,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  /** Ask, and resolve with the answer or with `null` for every kind of no. */
  ask<T>(kind: AskKind, payload: unknown): Promise<T | null> {
    const id = randomUUID()
    return new Promise<T | null>((resolve) => {
      const settle = (value: unknown): void => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve((value ?? null) as T | null)
      }
      const timer = setTimeout(() => settle(null), this.timeoutMs)
      this.pending.set(id, settle)

      if (!this.deliver({ id, kind, payload })) settle(null)
    })
  }

  /** The renderer's answer. An id nobody is waiting for is ignored, not an error. */
  answer(id: string, value: unknown): void {
    this.pending.get(id)?.(value)
  }

  /** Deny everything outstanding: the window went away, or the app is quitting. */
  cancelAll(): void {
    for (const settle of [...this.pending.values()]) settle(null)
    this.pending.clear()
  }

  /** How many questions are waiting. Used by tests and by the quit path. */
  get outstanding(): number {
    return this.pending.size
  }
}
