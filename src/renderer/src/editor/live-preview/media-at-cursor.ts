import { syntaxTree } from '@codemirror/language'
import { resolveAssetUrl } from '@core/asset'
import type { EditorView } from '@codemirror/view'
import type { MediaViewerTarget } from '@/state/ui'
import { docPathFacet } from '../doc-context'

/**
 * The diagram, image or block equation the caret is inside, if any.
 *
 * The corner control on a rendered block cannot be reached from the keyboard —
 * it lives inside a CodeMirror widget, and there is nothing in a contenteditable
 * to tab to. So the command works from the other side: put the caret in the
 * fence, the `![]()` or the `$$…$$` (which reveals the source anyway) and this
 * finds what to open.
 */
export function mediaAtCursor(view: EditorView): MediaViewerTarget | null {
  const state = view.state
  const pos = state.selection.main.head
  let found: MediaViewerTarget | null = null
  let narrowest = Infinity

  // Containment rather than `resolveInner`, which has to be told which side of
  // the position to look at — and the caret lands exactly on a fence's opening
  // edge when the block was clicked to reveal it, the one case that matters most.
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from > pos || node.to < pos) return false
      const width = node.to - node.from
      if (width >= narrowest) return
      if (node.name === 'Image') {
        const urlNode = node.node.getChild('URL')
        if (!urlNode) return
        const raw = state.doc.sliceString(urlNode.from, urlNode.to)
        const src = resolveAssetUrl(state.facet(docPathFacet), raw)
        if (!src) return
        const marks = node.node.getChildren('LinkMark')
        const alt = marks[0] && marks[1] ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
        found = { kind: 'image', src, alt }
        narrowest = width
      } else if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'mermaid') return
        const body = node.node.getChild('CodeText')
        const code = body ? state.doc.sliceString(body.from, body.to) : ''
        if (!code.trim()) return
        found = { kind: 'mermaid', code }
        narrowest = width
      }
      return
    }
  })
  if (found) return found

  // Block maths is matched by regex rather than parsed, exactly as the renderer
  // does it — there is no `$$` node in the tree to resolve against.
  const text = state.doc.toString()
  const block = /\$\$([\s\S]+?)\$\$/g
  let m: RegExpExecArray | null
  while ((m = block.exec(text)) !== null) {
    if (pos >= m.index && pos <= m.index + m[0].length && m[1]!.trim()) {
      return { kind: 'math', code: m[1]!.trim() }
    }
  }
  return null
}
