/**
 * The marks on a document, gathered into a list.
 *
 * An annotation in a PDF is attached to a place on a page, which is where you
 * want it while reading and useless when the question is "what did I mark in
 * this paper". A list answers that one, and is how anybody reviews their own
 * notes on something long.
 *
 * Pure: given what pdf.js reports per page, it decides what belongs in the list
 * and in what order. What does not belong is as important as what does — a link
 * is not a comment, and a popup is the bubble another annotation opens rather
 * than a mark of its own.
 */

/** The parts of a pdf.js annotation this reads. Everything else is ignored. */
export interface RawAnnotation {
  id?: string
  subtype?: string
  contentsObj?: { str?: string }
  titleObj?: { str?: string }
}

export interface AnnotationRef {
  id: string
  /** 1-based, as a reader counts pages. */
  page: number
  /** `Highlight`, `FreeText`, `Ink`, `Stamp`, … */
  kind: string
  /** What was written on it, empty for a mark with no words. */
  text: string
  /** Who made it, when the document says. */
  author: string
}

/**
 * Subtypes that are not marks somebody made.
 *
 * `Popup` is the bubble another annotation opens — listing it would double
 * every comment. `Link` and `Widget` are the document's own furniture: a
 * cross-reference and a form field are not notes on it.
 */
const NOT_A_MARK = new Set(['Popup', 'Link', 'Widget'])

export function annotationList(
  pages: readonly { page: number; annotations: readonly RawAnnotation[] }[]
): AnnotationRef[] {
  const list: AnnotationRef[] = []
  for (const { page, annotations } of pages) {
    for (const annotation of annotations) {
      const kind = annotation.subtype ?? ''
      if (kind === '' || NOT_A_MARK.has(kind)) continue
      list.push({
        id: annotation.id ?? `${page}:${list.length}`,
        page,
        kind,
        text: (annotation.contentsObj?.str ?? '').trim(),
        author: (annotation.titleObj?.str ?? '').trim()
      })
    }
  }
  // Down the document, which is the order somebody reading it would meet them.
  return list.sort((a, b) => a.page - b.page)
}

/** What to show for a mark that carries no words of its own. */
export function annotationLabel(mark: AnnotationRef): string {
  if (mark.text !== '') return mark.text
  switch (mark.kind) {
    case 'Highlight':
      return 'Highlighted'
    case 'Ink':
      return 'Drawing'
    case 'Stamp':
      return 'Image'
    case 'FreeText':
      return 'Empty text box'
    default:
      return mark.kind
  }
}
