import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/settings'
import { lineWidthCss } from './line-width'

describe('lineWidthCss', () => {
  const base = defaultSettings.editor

  it('defaults to the normal reading column', () => {
    expect(base.lineWidth).toBe('normal')
    expect(lineWidthCss(base)).toBe('46rem')
  })

  it('maps every preset', () => {
    expect(lineWidthCss({ ...base, lineWidth: 'narrow' })).toBe('38rem')
    expect(lineWidthCss({ ...base, lineWidth: 'wide' })).toBe('62rem')
    expect(lineWidthCss({ ...base, lineWidth: 'full' })).toBe('none')
  })

  it('uses the exact pixel value for custom', () => {
    expect(lineWidthCss({ ...base, lineWidth: 'custom', customLineWidth: 1234 })).toBe('1234px')
  })
})
