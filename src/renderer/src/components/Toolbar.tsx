import { useState, useRef, useEffect } from 'react'
import { undo, redo } from '@codemirror/commands'
import { getActiveView } from '@/editor/active-view'
import {
  applyInlineFormat,
  applyLinePrefix,
  formatAndUnwrapNote,
  insertCallout,
  insertCodeBlock,
  insertMathBlock,
  insertMermaidBlock,
  insertSnippet,
  insertTableTemplate
} from '@/editor/format-helpers'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

export function Toolbar(): React.JSX.Element | null {
  const visible = useStore((s) => s.showFormattingToolbar)
  const activeId = useStore((s) => s.activeId)
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false)
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false)
  const headingMenuRef = useRef<HTMLDivElement>(null)
  const calloutMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (headingMenuRef.current && !headingMenuRef.current.contains(e.target as Node)) {
        setHeadingMenuOpen(false)
      }
      if (calloutMenuRef.current && !calloutMenuRef.current.contains(e.target as Node)) {
        setCalloutMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [])

  if (!visible || !activeId) return null

  const handleUndo = (): void => {
    const view = getActiveView()
    if (view) {
      undo(view)
      view.focus()
    }
  }

  const handleRedo = (): void => {
    const view = getActiveView()
    if (view) {
      redo(view)
      view.focus()
    }
  }

  return (
    <div className="formatting-toolbar" role="toolbar" aria-label="Formatting tools">
      <div className="toolbar__group">
        <button className="toolbar__btn" title="Undo (Ctrl+Z)" onClick={handleUndo}>
          <Icon name="undo" size={14} />
        </button>
        <button className="toolbar__btn" title="Redo (Ctrl+Shift+Z)" onClick={handleRedo}>
          <Icon name="redo" size={14} />
        </button>
      </div>

      <div className="toolbar__sep" />

      {/* Heading dropdown */}
      <div className="toolbar__dropdown-wrapper" ref={headingMenuRef}>
        <button
          className={`toolbar__btn toolbar__btn--dropdown${headingMenuOpen ? ' toolbar__btn--active' : ''}`}
          title="Headings"
          onClick={() => setHeadingMenuOpen((o) => !o)}
        >
          <Icon name="heading" size={14} />
          <Icon name="chevron-down" size={10} />
        </button>
        {headingMenuOpen && (
          <div className="toolbar__menu">
            <button
              className="toolbar__menu-item"
              onClick={() => {
                applyLinePrefix('# ')
                setHeadingMenuOpen(false)
              }}
            >
              <span className="toolbar__menu-h1">Heading 1</span>
              <kbd>#</kbd>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                applyLinePrefix('## ')
                setHeadingMenuOpen(false)
              }}
            >
              <span className="toolbar__menu-h2">Heading 2</span>
              <kbd>##</kbd>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                applyLinePrefix('### ')
                setHeadingMenuOpen(false)
              }}
            >
              <span className="toolbar__menu-h3">Heading 3</span>
              <kbd>###</kbd>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                applyLinePrefix('#### ')
                setHeadingMenuOpen(false)
              }}
            >
              <span className="toolbar__menu-h4">Heading 4</span>
              <kbd>####</kbd>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          title="Bold (Ctrl+B)"
          onClick={() => applyInlineFormat('**')}
        >
          <Icon name="bold" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Italic (Ctrl+I)"
          onClick={() => applyInlineFormat('*')}
        >
          <Icon name="italic" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Strikethrough"
          onClick={() => applyInlineFormat('~~')}
        >
          <Icon name="strikethrough" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Highlight (==text==)"
          onClick={() => applyInlineFormat('==')}
        >
          <span className="toolbar__btn-hl">==</span>
        </button>
        <button
          className="toolbar__btn"
          title="Inline code (`code`)"
          onClick={() => applyInlineFormat('`')}
        >
          <Icon name="code" size={14} />
        </button>
      </div>

      <div className="toolbar__sep" />

      {/* Lists & Quotes */}
      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          title="Bullet list (-)"
          onClick={() => applyLinePrefix('- ')}
        >
          <Icon name="list" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Numbered list (1.)"
          onClick={() => applyLinePrefix('1. ')}
        >
          <Icon name="list-ordered" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Task checklist (- [ ])"
          onClick={() => applyLinePrefix('- [ ] ')}
        >
          <Icon name="check-square" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Blockquote (>)"
          onClick={() => applyLinePrefix('> ')}
        >
          <Icon name="quote" size={14} />
        </button>
      </div>

      <div className="toolbar__sep" />

      {/* Callout Dropdown */}
      <div className="toolbar__dropdown-wrapper" ref={calloutMenuRef}>
        <button
          className={`toolbar__btn toolbar__btn--dropdown${calloutMenuOpen ? ' toolbar__btn--active' : ''}`}
          title="Insert Callout box"
          onClick={() => setCalloutMenuOpen((o) => !o)}
        >
          <Icon name="callout" size={14} />
          <Icon name="chevron-down" size={10} />
        </button>
        {calloutMenuOpen && (
          <div className="toolbar__menu">
            <button
              className="toolbar__menu-item"
              onClick={() => {
                insertCallout('NOTE')
                setCalloutMenuOpen(false)
              }}
            >
              <span>ℹ Note</span>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                insertCallout('TIP')
                setCalloutMenuOpen(false)
              }}
            >
              <span>💡 Tip</span>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                insertCallout('IMPORTANT')
                setCalloutMenuOpen(false)
              }}
            >
              <span>📌 Important</span>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                insertCallout('WARNING')
                setCalloutMenuOpen(false)
              }}
            >
              <span>⚠️ Warning</span>
            </button>
            <button
              className="toolbar__menu-item"
              onClick={() => {
                insertCallout('CAUTION')
                setCalloutMenuOpen(false)
              }}
            >
              <span>🛑 Caution</span>
            </button>
          </div>
        )}
      </div>

      {/* Inserts: Table, Code block, Math, Diagram, Links */}
      <div className="toolbar__group">
        <button className="toolbar__btn" title="Insert Table" onClick={() => insertTableTemplate()}>
          <Icon name="table" size={14} />
        </button>
        <button className="toolbar__btn" title="Insert Code Block" onClick={() => insertCodeBlock('')}>
          <Icon name="file-text" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Insert Link [title](url)"
          onClick={() => insertSnippet('[$SEL](url)')}
        >
          <Icon name="link" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Insert Wikilink [[Note]]"
          onClick={() => insertSnippet('[[$SEL]]')}
        >
          <span className="toolbar__btn-wiki">[[]]</span>
        </button>
        <button
          className="toolbar__btn"
          title="Insert Image ![alt](url)"
          onClick={() => insertSnippet('![$SEL](url)')}
        >
          <Icon name="image" size={14} />
        </button>
        <button className="toolbar__btn" title="Math Formula ($$)" onClick={insertMathBlock}>
          <Icon name="math" size={14} />
        </button>
        <button className="toolbar__btn" title="Mermaid Diagram" onClick={insertMermaidBlock}>
          <Icon name="diagram" size={14} />
        </button>
        <button
          className="toolbar__btn"
          title="Horizontal Rule (---)"
          onClick={() => insertSnippet('\n---\n')}
        >
          <span className="toolbar__btn-hr">—</span>
        </button>
      </div>

      <span className="toolbar__sep" />

      {/* Format & Beautify */}
      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          title="Beautify & Unwrap Paragraphs (Ctrl+Shift+P > Unwrap)"
          onClick={formatAndUnwrapNote}
        >
          <Icon name="sparkle" size={14} />
        </button>
      </div>
    </div>
  )
}
