import { describe, expect, it } from 'vitest'
import type { Settings } from '@shared/settings'
import { documentTypography } from './typography'

/**
 * The variables every text surface in a pane is set by.
 *
 * Worth testing on its own because more than one surface reads them and only
 * one of them used to declare them — which is how a diff came to be set at a
 * fixed size in the wrong face while the setting moved underneath it.
 */

const editor = {
  fontSize: 15,
  lineHeight: 1.7,
  fontFamily: '',
  lineWidth: 'normal',
  customLineWidth: 700
} as unknown as Settings['editor']

describe('how a document is set', () => {
  it('carries the size the setting asks for, which is what page zoom moves', () => {
    expect(documentTypography(editor, 'prose')['--or-editor-font-size']).toBe('15px')
    expect(documentTypography(editor, 'code')['--or-editor-font-size']).toBe('15px')
  })

  it('sets prose in the prose face, down a measured column', () => {
    const vars = documentTypography(editor, 'prose')
    expect(vars['--or-editor-font-family']).toBe('var(--or-prose-font)')
    expect(vars['--or-editor-max-width']).toBe('46rem')
    expect(vars['--or-editor-line-pad']).toBe('2rem')
  })

  it('sets code in the mono face, across the whole pane', () => {
    // A code file in the prose font loses the column alignment indentation
    // depends on, and is read down its left edge rather than centred.
    const vars = documentTypography(editor, 'code')
    expect(vars['--or-editor-font-family']).toBe('var(--or-mono-font)')
    expect(vars['--or-editor-max-width']).toBe('none')
    expect(vars['--or-editor-line-pad']).toBe('0.75rem')
  })

  it('lets an explicit font win for either kind', () => {
    const chosen = { ...editor, fontFamily: 'Iosevka' }
    expect(documentTypography(chosen, 'prose')['--or-editor-font-family']).toBe('Iosevka')
    expect(documentTypography(chosen, 'code')['--or-editor-font-family']).toBe('Iosevka')
  })

  it('follows the line-width setting for prose and ignores it for code', () => {
    const wide = { ...editor, lineWidth: 'wide' } as unknown as Settings['editor']
    expect(documentTypography(wide, 'prose')['--or-editor-max-width']).toBe('62rem')
    expect(documentTypography(wide, 'code')['--or-editor-max-width']).toBe('none')
  })
})
