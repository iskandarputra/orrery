/**
 * Markdown footnotes: `[^1]` in the text, `[^1]: the note` at the bottom.
 *
 * Not part of the markdown grammar the editor parses, so they are found by
 * scanning, the same way wikilinks are. Kept pure so the pairing rules can be
 * tested without an editor: which reference belongs to which definition, and
 * what to do about the ones that belong to nothing.
 */

export interface FootnoteRef {
  /** The label between `[^` and `]`. */
  label: string
  from: number
  to: number
}

export interface FootnoteDef {
  label: string
  from: number
  to: number
  /** The text after the colon, trimmed. */
  text: string
}

export interface Footnotes {
  refs: FootnoteRef[]
  defs: FootnoteDef[]
}

/** `[^label]` where it is used, excluding the definition at the start of a line. */
const REF = /\[\^([^\]\s]+)\]/g
/** `[^label]: text` at the start of a line. */
const DEF = /^[ \t]{0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm

/**
 * Every reference and definition in a document.
 *
 * A definition also matches the reference pattern, so definitions are found
 * first and any reference starting at the same place is dropped — otherwise the
 * label at the bottom of the file is rendered as a footnote marker pointing at
 * itself.
 */
export function findFootnotes(text: string): Footnotes {
  const defs: FootnoteDef[] = []
  DEF.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DEF.exec(text)) !== null) {
    defs.push({
      label: match[1]!,
      from: match.index,
      to: match.index + match[0].length,
      text: (match[2] ?? '').trim()
    })
  }

  const defStarts = new Set(defs.map((d) => text.indexOf('[^', d.from)))
  const refs: FootnoteRef[] = []
  REF.lastIndex = 0
  while ((match = REF.exec(text)) !== null) {
    if (defStarts.has(match.index)) continue
    refs.push({ label: match[1]!, from: match.index, to: match.index + match[0].length })
  }
  return { refs, defs }
}

/**
 * The number shown for each label, in the order the references appear.
 *
 * Markdown lets a footnote be labelled anything — `[^note]`, `[^a]` — and every
 * renderer numbers them by first use rather than showing the label. Two
 * references to one label share a number, which is the point of labelling them.
 */
export function numbering(footnotes: Footnotes): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const ref of footnotes.refs) {
    if (!numbers.has(ref.label)) numbers.set(ref.label, numbers.size + 1)
  }
  // A definition nobody referenced still deserves a number, so the list at the
  // bottom does not renumber itself when a reference is deleted.
  for (const def of footnotes.defs) {
    if (!numbers.has(def.label)) numbers.set(def.label, numbers.size + 1)
  }
  return numbers
}

/** The definition for a label, or null when the reference points at nothing. */
export function definitionFor(footnotes: Footnotes, label: string): FootnoteDef | null {
  return footnotes.defs.find((d) => d.label === label) ?? null
}
