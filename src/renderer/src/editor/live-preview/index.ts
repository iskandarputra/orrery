import type { Extension } from '@codemirror/state'
import { embedRendering } from './embeds'
import { composeLivePreview, type LivePreviewOptions } from './compose'

export type { LivePreviewOptions }

/**
 * The orrery live-preview experience: markdown renders in place, syntax marks
 * reappear around the cursor. Future features (math, mermaid, tables) are new
 * feature modules added to the list in `compose.ts`.
 */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  return composeLivePreview(options, embedRendering(options.reveal ?? true))
}
