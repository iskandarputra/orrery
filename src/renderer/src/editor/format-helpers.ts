import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import { appState } from '@/state/app-state-access'
import { unwrapParagraphs } from '@core/reflow'
import { getActiveView } from './active-view'
import { toggleInlineMarkSpec } from './inline-format'

/** Beautify and unwrap hard-wrapped lines inside paragraphs across whole doc or selection. */
export function formatAndUnwrapNote(): void {
  const view = getActiveView()
  if (!view) return
  const { from, to } = view.state.selection.main
  const [start, end] = from === to ? [0, view.state.doc.length] : [from, to]
  const original = view.state.sliceDoc(start, end)
  const reflowed = unwrapParagraphs(original)
  if (reflowed !== original) {
    view.dispatch({
      changes: { from: start, to: end, insert: reflowed },
      scrollIntoView: true,
      userEvent: 'input'
    })
    view.focus()
    appState().showToast('Paragraphs formatted and unwrapped', 'success')
  } else {
    appState().showToast('Paragraphs are already formatted', 'info')
  }
}

/** Toggle inline formatting (e.g. **, *, ~~, ==, `) */
export function applyInlineFormat(marker: string): void {
  const view = getActiveView()
  if (!view) return
  view.dispatch(toggleInlineMarkSpec(view.state, marker), {
    scrollIntoView: true,
    userEvent: 'input'
  })
  view.focus()
}

/** Compute line prefix changes over an EditorState. */
export function getLinePrefixChanges(
  state: Pick<EditorState, 'doc' | 'selection'>,
  prefix: string
): ChangeSpec[] {
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const changes: ChangeSpec[] = []

  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n)
    const text = line.text

    if (prefix.startsWith('#')) {
      const match = text.match(/^(#{1,6}\s+)/)
      if (match) {
        const existingPrefix = match[1]!
        if (existingPrefix === prefix) {
          changes.push({ from: line.from, to: line.from + existingPrefix.length, insert: '' })
        } else {
          changes.push({ from: line.from, to: line.from + existingPrefix.length, insert: prefix })
        }
      } else {
        changes.push({ from: line.from, insert: prefix })
      }
    } else if (prefix === '- [ ] ') {
      const match = text.match(/^(\s*)-\s+\[[ xX]\]\s+/)
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] ?? '' })
      } else {
        changes.push({ from: line.from, insert: prefix })
      }
    } else if (prefix === '> ') {
      if (text.startsWith('> ')) {
        changes.push({ from: line.from, to: line.from + 2, insert: '' })
      } else {
        changes.push({ from: line.from, insert: '> ' })
      }
    } else if (prefix === '- ') {
      const match = text.match(/^(\s*)[-*+]\s+/)
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] ?? '' })
      } else {
        changes.push({ from: line.from, insert: prefix })
      }
    } else if (prefix === '1. ') {
      const match = text.match(/^(\s*)\d+\.\s+/)
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] ?? '' })
      } else {
        changes.push({ from: line.from, insert: `${n - startLine.number + 1}. ` })
      }
    } else {
      changes.push({ from: line.from, insert: prefix })
    }
  }
  return changes
}

/** Toggle or set line prefix on current selection/line. */
export function applyLinePrefix(prefix: string): void {
  const view = getActiveView()
  if (!view) return
  const changes = getLinePrefixChanges(view.state, prefix)
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

/** Compute snippet insertion text replacing $SEL. */
export function getSnippetInsertion(snippet: string, selectedText: string): string {
  if (snippet.includes('$SEL')) {
    return snippet.replace('$SEL', selectedText || 'text')
  }
  return snippet
}

/** Insert a snippet at the cursor with selection range placed inside placeholders. */
export function insertSnippet(snippet: string, cursorOffset?: number): void {
  const view = getActiveView()
  if (!view) return
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)
  const insertion = getSnippetInsertion(snippet, selectedText)

  view.dispatch({
    changes: { from, to, insert: insertion },
    selection: EditorSelection.cursor(
      cursorOffset != null ? from + cursorOffset : from + insertion.length
    ),
    scrollIntoView: true,
    userEvent: 'input'
  })
  view.focus()
}

/** Insert callout block */
export function insertCallout(type: 'NOTE' | 'TIP' | 'WARNING' | 'IMPORTANT' | 'CAUTION'): void {
  const snippet = `> [!${type}]\n> `
  insertSnippet(snippet, snippet.length)
}

/** Insert markdown table template */
export function insertTableTemplate(rows = 3, cols = 3): void {
  let table = '\n|'
  for (let c = 1; c <= cols; c++) table += ` Header ${c} |`
  table += '\n|'
  for (let c = 1; c <= cols; c++) table += ' --- |'
  for (let r = 1; r <= rows - 1; r++) {
    table += '\n|'
    for (let c = 1; c <= cols; c++) table += ` Cell ${r},${c} |`
  }
  table += '\n\n'
  insertSnippet(table)
}

/** Insert code block with optional language */
export function insertCodeBlock(lang = ''): void {
  const snippet = `\n\`\`\`${lang}\n$SEL\n\`\`\`\n`
  insertSnippet(snippet)
}

/** Insert math block */
export function insertMathBlock(): void {
  const snippet = `\n$$\n$SEL\n$$\n`
  insertSnippet(snippet)
}

/** Insert Mermaid diagram */
export function insertMermaidBlock(): void {
  const snippet = `\n\`\`\`mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result 1]\n    B -->|No| D[Result 2]\n\`\`\`\n`
  insertSnippet(snippet)
}
