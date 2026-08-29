/**
 * Timestamp identifiers for notes, in the Zettelkasten style.
 *
 * The point of a dated identifier is that it is unique without consulting
 * anything: two notes made in the same minute are the only collision possible,
 * and the vault's free-name search settles that. It also sorts chronologically
 * for free, which is why the fields run from largest to smallest.
 */

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/**
 * `YYYYMMDDHHmm` in local time.
 *
 * Local rather than UTC: the identifier is a label a person reads and matches
 * against when they wrote it, and a note written at 9am should not be stamped
 * with the previous evening.
 */
export function noteId(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes())
  ].join('')
}

/** Is this the name of a note that was given a timestamp identifier? */
export function isNoteId(name: string): boolean {
  return /^\d{12}$/.test(name)
}

/**
 * Pick one at random.
 *
 * Returns null for an empty vault rather than throwing: "there is nothing to
 * open" is a state, not a fault.
 */
export function pickRandom<T>(items: readonly T[], random: () => number = Math.random): T | null {
  if (items.length === 0) return null
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))] ?? null
}
