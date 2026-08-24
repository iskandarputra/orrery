import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { BuildContext, Feature } from '../context'

/**
 * `[label](url)` and `![alt](url)` — show only the label, styled as a link
 * carrying its target in data-url (Mod+click opens externally; see plugin
 * event handler). Reveals to raw syntax when the cursor enters.
 */
function decorate(node: SyntaxNode, ctx: BuildContext, isImage: boolean): void {
  if (ctx.revealed(node.from, node.to)) return

  const marks = node.getChildren('LinkMark')
  const url = node.getChild('URL')
  if (marks.length < 2) return

  const openMark = marks[0]
  const closeMark = marks[1]
  if (!openMark || !closeMark) return
  const labelFrom = openMark.to
  const labelTo = closeMark.from
  if (labelFrom >= labelTo) return // empty label — leave raw

  const href = url ? ctx.state.doc.sliceString(url.from, url.to) : ''
  ctx.add(
    Decoration.mark({
      class: isImage ? 'cm-zy-link-text cm-zy-image-alt' : 'cm-zy-link-text',
      attributes: { 'data-url': href, title: href }
    }).range(labelFrom, labelTo)
  )

  // Conceal everything around the label: `[` / `![` prefix and `](url)` suffix.
  ctx.conceal(node.from, labelFrom)
  ctx.conceal(labelTo, node.to)
}

/**
 * `renderImages` off → images fall back to concealed alt-text here. When on,
 * the imageRendering() StateField owns Image nodes, so this skips them.
 */
export function links(options: { renderImages: boolean }): Feature {
  return {
    nodes: options.renderImages ? ['Link'] : ['Link', 'Image'],
    enter(node, ctx) {
      decorate(node.node, ctx, node.name === 'Image')
    }
  }
}
