/**
 * When a command typed into the integrated terminal has finished, near enough.
 *
 * Source control hears about most changes on its own: commits and staging
 * through the `.git` watch, saves directly, files in open folders through the
 * vault watch, and anything done in another program when the window comes back.
 * A command run in the terminal inside the app is none of those. `echo > a.md`
 * in a folder the tree has closed changed a file nothing heard, and the window
 * never lost focus to say so.
 *
 * Every burst of output would be the wrong signal: a dev server or a test
 * watcher prints all day, and each read of status is a git process. So this
 * waits for a line to be submitted, then for the output that follows to go
 * quiet, and fires once. More output after that is not a new command, and
 * does nothing until the next line is submitted.
 */

/** The timer, passed in, so the rule can be tested without waiting. */
export interface Clock {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface CommandSettle {
  /** What was typed or pasted into the shell. */
  input(data: string): void
  /** Some output arrived from the shell. */
  output(): void
  /** Stop, and forget any command waiting to settle. */
  dispose(): void
}

/** A carriage return is Enter in a terminal; a pasted block brings newlines. */
export function submitsLine(data: string): boolean {
  return /[\r\n]/.test(data)
}

export function commandSettle(onSettled: () => void, quietMs: number, clock: Clock): CommandSettle {
  let armed = false
  let handle: unknown = null

  const restart = (): void => {
    if (handle !== null) clock.clear(handle)
    handle = clock.set(() => {
      handle = null
      armed = false
      onSettled()
    }, quietMs)
  }

  return {
    input(data) {
      if (!submitsLine(data)) return
      armed = true
      restart()
    },
    output() {
      if (armed) restart()
    },
    dispose() {
      if (handle !== null) clock.clear(handle)
      handle = null
      armed = false
    }
  }
}
