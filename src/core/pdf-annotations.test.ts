import { describe, expect, it } from 'vitest'
import { annotationLabel, annotationList, type RawAnnotation } from './pdf-annotations'

const mark = (subtype: string, str?: string, id = subtype): RawAnnotation => ({
  id,
  subtype,
  ...(str === undefined ? {} : { contentsObj: { str } })
})

describe('annotationList', () => {
  it('gathers the marks with the page each is on', () => {
    const list = annotationList([
      { page: 1, annotations: [mark('Highlight', 'worth remembering')] },
      { page: 2, annotations: [mark('FreeText', 'a note to self')] }
    ])
    expect(list.map((m) => [m.page, m.kind, m.text])).toEqual([
      [1, 'Highlight', 'worth remembering'],
      [2, 'FreeText', 'a note to self']
    ])
  })

  it("leaves out the document's own furniture", () => {
    // A cross-reference and a form field are not notes somebody made on it, and
    // a popup is the bubble another annotation opens — listing it would show
    // every comment twice.
    const list = annotationList([
      {
        page: 1,
        annotations: [mark('Link'), mark('Widget'), mark('Popup'), mark('Ink')]
      }
    ])
    expect(list.map((m) => m.kind)).toEqual(['Ink'])
  })

  it('reads down the document, however the pages arrived', () => {
    const list = annotationList([
      { page: 9, annotations: [mark('Ink', '', 'late')] },
      { page: 2, annotations: [mark('Ink', '', 'early')] }
    ])
    expect(list.map((m) => m.page)).toEqual([2, 9])
  })

  it('gives every mark an id, even one the document did not name', () => {
    const list = annotationList([{ page: 3, annotations: [{ subtype: 'Highlight' }] }])
    expect(list[0]?.id).toBeTruthy()
  })

  it('has nothing to say about a document with no marks on it', () => {
    expect(annotationList([{ page: 1, annotations: [] }])).toEqual([])
  })
})

describe('annotationLabel', () => {
  it('shows what was written, when something was', () => {
    expect(annotationLabel({ id: 'a', page: 1, kind: 'FreeText', text: 'hello', author: '' })).toBe(
      'hello'
    )
  })

  it('says what kind of mark it is when it carries no words', () => {
    // A highlight usually has no text of its own; "Highlight" as a row label
    // reads as a category, and a blank row reads as a bug.
    expect(annotationLabel({ id: 'a', page: 1, kind: 'Highlight', text: '', author: '' })).toBe(
      'Highlighted'
    )
    expect(annotationLabel({ id: 'b', page: 1, kind: 'Ink', text: '', author: '' })).toBe('Drawing')
  })
})
