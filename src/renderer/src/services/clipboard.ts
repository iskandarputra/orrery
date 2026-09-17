import { invoke } from './client'

/**
 * Put text on the clipboard.
 *
 * Through main rather than `navigator.clipboard`, which rejects when the page
 * does not have focus, and every caller here ignored the rejection. On CI's
 * display "Copy Relative Path" left the clipboard empty with nothing said,
 * though locally it wrote even with the window blurred; a page without focus
 * is the likeliest reading of CI, not a measured one. Electron's clipboard in
 * main has no such condition either way.
 */
export function copyText(text: string): Promise<void> {
  return invoke('clipboard:writeText', { text })
}
