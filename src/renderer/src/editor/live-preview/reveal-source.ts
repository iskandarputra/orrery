import type { EditorView } from '@codemirror/view'

/**
 * Put the cursor on the source a rendered widget replaced.
 *
 * Every interactive construct here does the same thing when clicked: move the
 * selection onto the text it is standing in for, so the raw markdown reveals
 * and can be edited. What none of them can do is remember *where* that text is.
 *
 * A widget is rebuilt on every document change, but `eq()` deliberately ignores
 * the offset — two widgets for the same image at different positions are the
 * same widget, and saying otherwise would re-render every card below an edit on
 * each keystroke, re-reading files and re-mounting nested editors. So when only
 * the offset changed, CodeMirror keeps the DOM it already has, and with it the
 * click handler that was built the first time.
 *
 * A handler that captured the offset in a closure therefore holds the position
 * the widget had when it was first drawn, forever. Type ten characters anywhere
 * above an embedded note and click it: the cursor lands ten characters early,
 * on whatever happens to be there, and the card never reveals — because the
 * selection never reached it.
 *
 * The offset has to be asked for at the moment of the click, and `posAtDOM` is
 * the question: it walks from the element to the view that owns it and reports
 * where that view currently sits. It cannot go stale, because it is not stored.
 */
export function revealSource(view: EditorView, dom: HTMLElement): void {
  view.dispatch({ selection: { anchor: view.posAtDOM(dom) }, scrollIntoView: true })
  view.focus()
}
