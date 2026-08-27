import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { blockquote } from './features/blockquote'
import { blockSpacing } from './features/block-spacing'
import { codeBlock } from './features/code-block'
import { emphasis } from './features/emphasis'
import { headings } from './features/headings'
import { highlight } from './features/highlight'
import { hr } from './features/hr'
import { htmlComment } from './features/html-comment'
import { inlineCode } from './features/inline-code'
import { links } from './features/links'
import { lists } from './features/lists'
import { tags } from './features/tags'
import { embedRendering } from './embeds'
import { frontmatterRendering } from './frontmatter'
import { imageRendering } from './images'
import { livePreviewPlugin } from './plugin'
import { mathRendering } from './math'
import { mermaidRendering } from './mermaid'
import { tableRendering } from './table'

export interface LivePreviewOptions {
  fancyBullets?: boolean
  interactiveCheckboxes?: boolean
  showImages?: boolean
  /**
   * Whether clicking/selecting reveals raw markdown around the cursor. False in
   * Reading mode → a static, fully-rendered document that never flips to source.
   */
  reveal?: boolean
}

/** Mod+click a rendered link to open it externally. */
const linkClickHandler = EditorView.domEventHandlers({
  click(event) {
    if (!event.ctrlKey && !event.metaKey) return false
    const target = (event.target as HTMLElement).closest?.('.cm-or-link-text')
    if (!(target instanceof HTMLElement)) return false
    const url = target.dataset['url']
    if (url && /^https?:/i.test(url)) {
      // Window creation is denied in main and http(s) is routed to the OS browser.
      window.open(url)
      event.preventDefault()
      return true
    }
    return false
  }
})

/**
 * The orrery live-preview experience: markdown renders in place, syntax marks
 * reappear around the cursor. Future features (math, mermaid, tables) are new
 * feature modules added to this list.
 */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  const {
    fancyBullets = true,
    interactiveCheckboxes = true,
    showImages = true,
    reveal = true
  } = options
  return [
    livePreviewPlugin(
      [
        headings,
        emphasis,
        highlight,
        inlineCode,
        links({ renderImages: showImages }),
        lists({ fancyBullets, interactiveCheckboxes }),
        blockSpacing,
        blockquote,
        hr,
        codeBlock,
        htmlComment,
        tags
      ],
      reveal
    ),
    frontmatterRendering(reveal),
    embedRendering(reveal),
    tableRendering(reveal),
    mathRendering(reveal),
    mermaidRendering(reveal),
    showImages ? imageRendering(reveal) : [],
    linkClickHandler
  ]
}
