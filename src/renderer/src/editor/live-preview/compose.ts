import { footnoteRendering } from '../footnotes'
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
import { frontmatterRendering } from './frontmatter'
import { imageRendering } from './images'
import { codeCardRendering } from './code-card'
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
 * The live-preview stack, minus whatever the caller wants to leave out.
 *
 * Separated from `index.ts` so that `preview-view` — which renders an embedded
 * note and therefore needs these extensions — does not have to import the
 * module that pulls embeds in. That import closed a cycle:
 * index → embeds → preview-view → index.
 *
 * The parameter is not only for the cycle. Passing no embed rendering is what
 * an embedded note wants anyway: two notes that embed each other would
 * otherwise mount a preview inside a preview for as long as the stack lasted.
 */
export function composeLivePreview(
  options: LivePreviewOptions = {},
  embeds: Extension = [],
  /**
   * Hovering a link to see the note behind it. Passed in rather than imported,
   * because the preview it opens is built by this very module: importing it
   * here would close the cycle, and a preview inside a preview is not wanted
   * anyway.
   */
  linkPreviews: Extension = []
): Extension {
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
    footnoteRendering(reveal),
    linkPreviews,
    embeds,
    tableRendering(reveal),
    codeCardRendering(reveal),
    mathRendering(reveal),
    mermaidRendering(reveal),
    showImages ? imageRendering(reveal) : [],
    linkClickHandler
  ]
}
