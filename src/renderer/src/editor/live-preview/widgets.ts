import { WidgetType, type EditorView } from '@codemirror/view'

/** Interactive task checkbox replacing `[ ]` / `[x]`. Clicking edits the doc. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className = 'cm-zy-task-checkbox'
    input.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(input)
      // The widget replaces the 3-char marker "[ ]" / "[x]"; flip the middle char.
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' }
      })
    })
    return input
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/** Round bullet replacing `-` / `*` / `+` list markers. */
export class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-zy-bullet'
    span.textContent = '•'
    return span
  }
}

/** Horizontal rule replacing `---` / `***` lines. */
export class HrWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-zy-hr'
    return span
  }
}
