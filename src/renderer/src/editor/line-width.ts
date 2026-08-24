import type { Settings } from '@shared/settings'

/**
 * CSS max-width for the editing canvas. Presets are reading-column widths
 * (rem, so they scale with root font size); 'full' removes the constraint.
 */
export function lineWidthCss(editor: Settings['editor']): string {
  switch (editor.lineWidth) {
    case 'narrow':
      return '38rem'
    case 'wide':
      return '62rem'
    case 'full':
      return 'none'
    case 'custom':
      return `${editor.customLineWidth}px`
    case 'normal':
      return '46rem'
  }
}
