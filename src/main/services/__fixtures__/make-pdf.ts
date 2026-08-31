/**
 * A PDF written out by hand, byte by byte.
 *
 * The reader is built on pdf.js, so a fixture built with a PDF library would
 * share a pile of assumptions with the thing under test — and a fixture checked
 * into the repository as an opaque blob tells nobody what it contains. This is
 * a few hundred bytes of the format itself: a catalogue, a page tree, one
 * content stream per page and an outline, with a real cross-reference table.
 *
 * Deliberately plain: Helvetica by name and not embedded, which is the case
 * pdf.js needs its bundled standard fonts for, so a broken asset copy shows up
 * here as a page with no text rather than as a mystery later.
 */

export interface PdfSpec {
  /** One entry per page; each string is a line drawn down the page. */
  pages: string[][]
  /** Optional bookmarks, each pointing at a 1-based page. */
  outline?: { title: string; page: number }[]
  /**
   * A single-line text field on page 1, for testing form filling.
   *
   * The smallest real AcroForm there is: a catalogue that declares one, a
   * widget annotation on the page, and a field with a name and no value.
   */
  textField?: { name: string }
}

/** Escape the characters a PDF literal string cannot carry raw. */
const literal = (text: string): string => `(${text.replace(/([\\()])/g, '\\$1')})`

export function makePdf({ pages, outline = [], textField }: PdfSpec): Buffer {
  const chunks: string[] = []
  const offsets: number[] = []
  let length = 0

  const push = (text: string): void => {
    chunks.push(text)
    length += Buffer.byteLength(text, 'latin1')
  }
  const object = (number: number, body: string): void => {
    offsets[number] = length
    push(`${number} 0 obj\n${body}\nendobj\n`)
  }

  const count = pages.length
  const pageNumber = (index: number): number => 3 + index * 2
  const contentNumber = (index: number): number => 4 + index * 2
  const fontNumber = 3 + count * 2
  const outlineRoot = fontNumber + 1
  const outlineItem = (index: number): number => outlineRoot + 1 + index
  const afterOutline =
    outline.length > 0 ? outlineItem(outline.length - 1) : outline.length === 0 ? fontNumber : 0
  const fieldNumber = afterOutline + 1
  const total = textField ? fieldNumber : afterOutline

  // The binary comment on the second line is what tells anything reading this
  // that the file is not text, and every real PDF has one.
  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')

  object(
    1,
    `<< /Type /Catalog /Pages 2 0 R` +
      `${outline.length > 0 ? ` /Outlines ${outlineRoot} 0 R` : ''}` +
      `${textField ? ` /AcroForm << /Fields [${fieldNumber} 0 R] /DA (/F1 12 Tf 0 g) >>` : ''} >>`
  )
  object(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNumber(i)} 0 R`).join(' ')}] /Count ${count} >>`
  )

  pages.forEach((lines, index) => {
    const stream = [
      'BT',
      '/F1 18 Tf',
      '24 TL',
      '72 720 Td',
      ...lines.map((line, i) => (i === 0 ? `${literal(line)} Tj` : `T* ${literal(line)} Tj`)),
      'ET'
    ].join('\n')

    object(
      pageNumber(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> ` +
        `${textField && index === 0 ? `/Annots [${fieldNumber} 0 R] ` : ''}` +
        `/Contents ${contentNumber(index)} 0 R >>`
    )
    object(
      contentNumber(index),
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
    )
  })

  object(fontNumber, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  if (outline.length > 0) {
    object(
      outlineRoot,
      `<< /Type /Outlines /First ${outlineItem(0)} 0 R ` +
        `/Last ${outlineItem(outline.length - 1)} 0 R /Count ${outline.length} >>`
    )
    outline.forEach((entry, index) => {
      const links = [
        index > 0 ? `/Prev ${outlineItem(index - 1)} 0 R` : '',
        index < outline.length - 1 ? `/Next ${outlineItem(index + 1)} 0 R` : ''
      ]
        .filter(Boolean)
        .join(' ')
      object(
        outlineItem(index),
        `<< /Title ${literal(entry.title)} /Parent ${outlineRoot} 0 R ${links} ` +
          `/Dest [${pageNumber(entry.page - 1)} 0 R /XYZ 0 792 0] >>`
      )
    })
  }

  if (textField) {
    object(
      fieldNumber,
      `<< /Type /Annot /Subtype /Widget /FT /Tx /T ${literal(textField.name)} ` +
        `/Rect [72 600 400 630] /F 4 /P ${pageNumber(0)} 0 R /DA (/F1 12 Tf 0 g) >>`
    )
  }

  // Every entry is exactly twenty bytes, which is the one rule of a
  // cross-reference table that readers actually rely on.
  const startxref = length
  const entries = [
    '0000000000 65535 f \n',
    ...Array.from(
      { length: total },
      (_, i) => `${String(offsets[i + 1] ?? 0).padStart(10, '0')} 00000 n \n`
    )
  ]
  push(`xref\n0 ${total + 1}\n${entries.join('')}`)
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

  return Buffer.from(chunks.join(''), 'latin1')
}
