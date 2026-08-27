import { describe, expect, it, vi } from 'vitest'
import { buildEditorMenu, type EditorMenuActions } from './editor-menu'

function actions(): EditorMenuActions {
  return {
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    format: vi.fn(),
    insertLink: vi.fn(),
    searchVault: vi.fn(),
    correctSpelling: vi.fn()
  }
}

const base = {
  x: 0,
  y: 0,
  selectionText: '',
  isEditable: true,
  misspelledWord: '',
  dictionarySuggestions: []
}

/** Labels of the real items, separators dropped. */
function labels(items: ReturnType<typeof buildEditorMenu>): string[] {
  return items.flatMap((i) => ('label' in i ? [i.label] : []))
}

describe('buildEditorMenu', () => {
  it('offers the clipboard actions on an editable surface', () => {
    const menu = labels(buildEditorMenu(base, actions()))
    expect(menu).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Select all']))
  })

  it('disables what a cursor with no selection cannot do', () => {
    const menu = buildEditorMenu(base, actions())
    const cut = menu.find((i) => 'label' in i && i.label === 'Cut')
    const copy = menu.find((i) => 'label' in i && i.label === 'Copy')
    expect(cut && 'disabled' in cut && cut.disabled).toBe(true)
    expect(copy && 'disabled' in copy && copy.disabled).toBe(true)
  })

  it('enables cut and copy once there is a selection', () => {
    const menu = buildEditorMenu({ ...base, selectionText: 'chosen' }, actions())
    const cut = menu.find((i) => 'label' in i && i.label === 'Cut')
    expect(cut && 'disabled' in cut && cut.disabled).toBe(false)
  })

  it('leaves out paste where nothing can be typed', () => {
    const menu = labels(buildEditorMenu({ ...base, isEditable: false }, actions()))
    expect(menu).not.toContain('Paste')
    expect(menu).toContain('Copy')
  })

  it('offers formatting only for a selection', () => {
    expect(labels(buildEditorMenu(base, actions()))).not.toContain('Bold')
    const withText = labels(buildEditorMenu({ ...base, selectionText: 'word' }, actions()))
    expect(withText).toEqual(expect.arrayContaining(['Bold', 'Italic', 'Link']))
  })

  it('puts spelling suggestions first, and calls back with the chosen word', () => {
    const acted = actions()
    const menu = buildEditorMenu(
      { ...base, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] },
      acted
    )
    expect(labels(menu).slice(0, 2)).toEqual(['the', 'ten'])
    const first = menu[0]
    if (first && 'onSelect' in first) first.onSelect()
    expect(acted.correctSpelling).toHaveBeenCalledWith('the')
  })

  it('says so when a word is flagged with no suggestions to offer', () => {
    const menu = labels(
      buildEditorMenu({ ...base, misspelledWord: 'orrery', dictionarySuggestions: [] }, actions())
    )
    expect(menu[0]).toMatch(/no suggestions/i)
  })

  it('offers to search the vault for a short selection, quoting it', () => {
    const menu = labels(buildEditorMenu({ ...base, selectionText: 'ownership' }, actions()))
    expect(menu.some((l) => l.includes('ownership'))).toBe(true)
  })

  it('truncates a long selection in the search label', () => {
    const long = 'a'.repeat(120)
    const menu = labels(buildEditorMenu({ ...base, selectionText: long }, actions()))
    const search = menu.find((l) => l.startsWith('Search vault'))!
    expect(search.length).toBeLessThan(60)
    expect(search).toContain('…')
  })

  it('never offers to search for whitespace only', () => {
    const menu = labels(buildEditorMenu({ ...base, selectionText: '   \n ' }, actions()))
    expect(menu.some((l) => l.startsWith('Search vault'))).toBe(false)
  })
})
