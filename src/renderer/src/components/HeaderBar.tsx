import { useState, useRef, useEffect } from 'react'
import { basename, dirname, stem } from '@core/paths'
import { getActiveView } from '@/editor/active-view'
import { formatAndUnwrapNote } from '@/editor/format-helpers'
import { invoke } from '@/services/client'
import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

export function HeaderBar(): React.JSX.Element | null {
  const activeId = useStore((s) => s.activeId)
  const buffer = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  const rootPath = useStore((s) => s.rootPath)
  const sidebarVisible = useStore((s) => s.settings.sidebar.visible)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const showFormattingToolbar = useStore((s) => s.showFormattingToolbar)
  const toggleFormattingToolbar = useStore((s) => s.toggleFormattingToolbar)
  const viewMode = useStore((s) => s.settings.editor.viewMode)
  const updateSettings = useStore((s) => s.updateSettings)
  const editorSettings = useStore((s) => s.settings.editor)
  const sidePanel = useStore((s) => s.sidePanel)
  const toggleSidePanel = useStore((s) => s.toggleSidePanel)
  const toggleGraph = useStore((s) => s.toggleGraph)
  const zenMode = useStore((s) => s.zenMode)
  const toggleZenMode = useStore((s) => s.toggleZenMode)
  const showToast = useStore((s) => s.showToast)
  const setDocStatsOpen = useStore((s) => s.setDocStatsOpen)
  const stats = useEditorStats()

  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [])

  if (!activeId || !buffer) return null

  // Calculate breadcrumbs from rootPath to filePath
  let folderBreadcrumb = ''
  if (rootPath && buffer.filePath && buffer.filePath.startsWith(rootPath)) {
    const rel = buffer.filePath.slice(rootPath.length).replace(/^[/\\]+/, '')
    const dir = dirname(rel)
    if (dir && dir !== '.') {
      folderBreadcrumb = dir
    }
  }

  const readingTimeMin = Math.max(1, Math.ceil(stats.words / 200))

  const handleExportHtml = async (): Promise<void> => {
    setExportMenuOpen(false)
    const view = getActiveView()
    if (!view) return
    const title = stem(buffer.fileName)
    try {
      await invoke('export:html', { title, markdown: view.state.doc.toString() })
      showToast(`Exported "${title}.html" successfully`, 'success')
    } catch (err) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleExportPdf = async (): Promise<void> => {
    setExportMenuOpen(false)
    const view = getActiveView()
    if (!view) return
    const title = stem(buffer.fileName)
    try {
      await invoke('export:pdf', { title, markdown: view.state.doc.toString() })
      showToast(`Exported "${title}.pdf" successfully`, 'success')
    } catch (err) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleCopyMarkdown = async (): Promise<void> => {
    setExportMenuOpen(false)
    const view = getActiveView()
    if (!view) return
    await navigator.clipboard.writeText(view.state.doc.toString())
    showToast('Markdown copied to clipboard', 'success')
  }

  const handleFind = (): void => {
    const view = getActiveView()
    if (view) {
      void useStore.getState().openPalette('commands')
    }
  }

  return (
    <header className="header-bar">
      {/* Left: Sidebar toggle + Breadcrumbs */}
      <div className="header-bar__left">
        {!sidebarVisible && (
          <button
            className="icon-btn header-bar__toggle-sidebar"
            title="Show sidebar (Ctrl+B)"
            onClick={toggleSidebar}
          >
            <Icon name="columns" size={15} />
          </button>
        )}
        <div className="header-bar__breadcrumbs" title={buffer.filePath ?? buffer.fileName}>
          {rootPath && (
            <>
              <span className="breadcrumb-vault" onClick={toggleSidebar}>
                <Icon name="folder" size={13} />
                <span>{basename(rootPath)}</span>
              </span>
              <span className="breadcrumb-sep">/</span>
            </>
          )}
          {folderBreadcrumb && (
            <>
              <span className="breadcrumb-folder">{folderBreadcrumb}</span>
              <span className="breadcrumb-sep">/</span>
            </>
          )}
          <span className="breadcrumb-file">
            <Icon name="file-text" size={13} className="breadcrumb-file__icon" />
            <span className="breadcrumb-file__name">{buffer.fileName}</span>
            {buffer.isDirty && <span className="breadcrumb-dirty" title="Unsaved changes">●</span>}
          </span>
        </div>
      </div>

      {/* Center: Reading time / stats pill. Prose only — "1 min read" on a
          JSON file is a number nobody asked for and nobody can use. */}
      <div className="header-bar__center">
        {buffer?.kind !== 'code' && (
          <button
            className="header-stats-pill"
            title="Click to view detailed document statistics"
            onClick={() => setDocStatsOpen(true)}
          >
            <span>{stats.words} words</span>
            <span className="header-stats-pill__dot">·</span>
            <span>{readingTimeMin} min read</span>
          </button>
        )}
      </div>

      {/* Right: Quick actions toolbar */}
      <div className="header-bar__right">
        {/* Find in note / command palette */}
        <button
          className="icon-btn header-btn"
          title="Search note or commands (Ctrl+P)"
          onClick={handleFind}
        >
          <Icon name="search" size={14} />
        </button>

        {/* Beautify / Unwrap Paragraphs */}
        <button
          className="icon-btn header-btn"
          title="Beautify & Unwrap Paragraphs (Ctrl+Shift+P > Unwrap)"
          onClick={formatAndUnwrapNote}
        >
          <Icon name="sparkle" size={14} />
        </button>

        {/* Formatting bar toggle */}
        <button
          className={`icon-btn header-btn${showFormattingToolbar ? ' header-btn--active' : ''}`}
          title="Toggle formatting ribbon"
          onClick={toggleFormattingToolbar}
        >
          <Icon name="type" size={15} />
        </button>

        {/* View mode segmented switcher */}
        <div className="header-viewmode" role="radiogroup" aria-label="View mode">
          <button
            role="radio"
            aria-checked={viewMode === 'source'}
            className={`header-viewmode__btn${viewMode === 'source' ? ' header-viewmode__btn--active' : ''}`}
            title="Edit mode (raw markdown source)"
            onClick={() => updateSettings({ editor: { ...editorSettings, viewMode: 'source' } })}
          >
            <Icon name="pencil" size={12} />
            <span>Edit</span>
          </button>
          <button
            role="radio"
            aria-checked={viewMode === 'live'}
            className={`header-viewmode__btn${viewMode === 'live' ? ' header-viewmode__btn--active' : ''}`}
            title="Hybrid mode (interactive live preview)"
            onClick={() => updateSettings({ editor: { ...editorSettings, viewMode: 'live' } })}
          >
            <Icon name="columns" size={12} />
            <span>Hybrid</span>
          </button>
          <button
            role="radio"
            aria-checked={viewMode === 'reading'}
            className={`header-viewmode__btn${viewMode === 'reading' ? ' header-viewmode__btn--active' : ''}`}
            title="Reading mode (rendered read-only)"
            onClick={() => updateSettings({ editor: { ...editorSettings, viewMode: 'reading' } })}
          >
            <Icon name="eye" size={12} />
            <span>Read</span>
          </button>
        </div>

        {/* Export dropdown */}
        <div className="header-dropdown-wrapper" ref={exportMenuRef}>
          <button
            className={`icon-btn header-btn${exportMenuOpen ? ' header-btn--active' : ''}`}
            title="Export / Share document"
            onClick={() => setExportMenuOpen((o) => !o)}
          >
            <Icon name="download" size={15} />
          </button>
          {exportMenuOpen && (
            <div className="header-dropdown-menu">
              <button className="header-dropdown-item" onClick={() => void handleExportHtml()}>
                <Icon name="file-text" size={14} />
                <span>Export as HTML…</span>
              </button>
              <button className="header-dropdown-item" onClick={() => void handleExportPdf()}>
                <Icon name="download" size={14} />
                <span>Export as PDF…</span>
              </button>
              <div className="header-dropdown-sep" />
              <button className="header-dropdown-item" onClick={() => void handleCopyMarkdown()}>
                <Icon name="copy" size={14} />
                <span>Copy Raw Markdown</span>
              </button>
            </div>
          )}
        </div>

        {/* Graph view */}
        <button
          className="icon-btn header-btn"
          title="Open knowledge graph (Ctrl+Shift+G)"
          onClick={toggleGraph}
        >
          <Icon name="diagram" size={15} />
        </button>

        {/* Outline panel */}
        <button
          className={`icon-btn header-btn${sidePanel === 'outline' ? ' header-btn--active' : ''}`}
          title="Toggle Table of Contents / Outline (Ctrl+Shift+U)"
          onClick={() => toggleSidePanel('outline')}
        >
          <Icon name="list" size={15} />
        </button>

        {/* AI Assistant */}
        <button
          className={`icon-btn header-btn${sidePanel === 'ai' ? ' header-btn--active' : ''}`}
          title="AI Assistant (Ctrl+Shift+A)"
          onClick={() => toggleSidePanel('ai')}
        >
          <Icon name="sparkle" size={15} />
        </button>

        {/* Zen mode */}
        <button
          className={`icon-btn header-btn${zenMode ? ' header-btn--active' : ''}`}
          title={zenMode ? 'Exit Zen Mode (Esc)' : 'Zen Writing Mode'}
          onClick={toggleZenMode}
        >
          <Icon name={zenMode ? 'minimize' : 'maximize'} size={14} />
        </button>
      </div>
    </header>
  )
}
