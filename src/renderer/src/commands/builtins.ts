import { openSearchPanel, replaceNext } from '@codemirror/search'
import { unwrapParagraphs } from '@core/reflow'
import { canvasFromCluster, clusterMoc, newCanvas } from '@/notes/canvas-commands'
import { openDailyNote } from '@/notes/daily'
import { stem } from '@core/paths'
import { toggleHighlight } from '@/editor/inline-format'
import { invoke } from '@/services/client'
import { THEMES } from '@/themes/themes'
import type { Command } from './registry'

/** Built-in commands referenced by menu items (src/main/menu.ts) by id. */
export const builtinCommands: Command[] = [
  {
    id: 'file.new',
    title: 'New File',
    run: ({ store }) => store().newUntitled()
  },
  {
    id: 'file.open',
    title: 'Open File…',
    run: ({ store }) => store().openFileDialog()
  },
  {
    id: 'file.save',
    title: 'Save',
    run: ({ store }) => {
      const { activeId, save } = store()
      if (activeId) void save(activeId)
    }
  },
  {
    id: 'file.saveAs',
    title: 'Save As…',
    run: ({ store }) => {
      const { activeId, save } = store()
      if (activeId) void save(activeId, { forceSaveAs: true })
    }
  },
  {
    id: 'workspace.openFolder',
    title: 'Open Folder…',
    run: ({ store }) => store().openFolder()
  },
  {
    id: 'tab.close',
    title: 'Close Tab',
    run: ({ store }) => {
      const { activeId, closeTab } = store()
      if (activeId) void closeTab(activeId)
    }
  },
  {
    id: 'view.toggleSidebar',
    title: 'Toggle Sidebar',
    run: ({ store }) => store().toggleSidebar()
  },
  {
    id: 'view.themeLight',
    title: 'Appearance: Light',
    run: ({ store }) => store().setThemeMode('light')
  },
  {
    id: 'view.themeDark',
    title: 'Appearance: Dark',
    run: ({ store }) => store().setThemeMode('dark')
  },
  {
    id: 'view.themeSystem',
    title: 'Appearance: System',
    run: ({ store }) => store().setThemeMode('system')
  },
  ...THEMES.map(
    (t): Command => ({
      id: `theme.select.${t.id}`,
      title: `Theme: ${t.name} (${t.appearance})`,
      run: ({ store }) => store().selectTheme(t.id)
    })
  ),
  {
    id: 'app.openSettings',
    title: 'Preferences…',
    run: ({ store }) => store().openSettings()
  },
  {
    id: 'view.toggleBacklinks',
    title: 'Toggle Backlinks Panel',
    run: ({ store }) => store().toggleSidePanel('backlinks')
  },
  {
    id: 'view.toggleOutline',
    title: 'Toggle Outline Panel',
    run: ({ store }) => store().toggleSidePanel('outline')
  },
  {
    id: 'view.toggleSearch',
    title: 'Search in Workspace',
    run: ({ store }) => store().toggleSidePanel('search')
  },
  {
    id: 'ai.openChat',
    title: 'AI: Chat with Vault',
    run: ({ store }) => store().toggleSidePanel('ai')
  },
  {
    id: 'ai.reindex',
    title: 'AI: Reindex Vault for Semantic Search',
    run: async ({ store }) => {
      const root = store().rootPath
      if (!root) {
        window.alert('Open a folder first.')
        return
      }
      try {
        const r = await invoke('embeddings:reindex', { rootPath: root })
        window.alert(
          r.embedded === 0
            ? `Index already up to date — ${r.chunks} chunks from ${r.files} notes.`
            : `Embedded ${r.embedded} changed note(s), reused ${r.reused}. ${r.chunks} chunks total.`
        )
      } catch (err) {
        window.alert(`Reindex failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  },
  {
    id: 'view.modeEdit',
    title: 'View Mode: Edit (source)',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({ editor: { ...e, viewMode: 'source' } })
    }
  },
  {
    id: 'view.modeHybrid',
    title: 'View Mode: Hybrid (live preview)',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({ editor: { ...e, viewMode: 'live' } })
    }
  },
  {
    id: 'view.modeReading',
    title: 'View Mode: Reading (view only)',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({ editor: { ...e, viewMode: 'reading' } })
    }
  },
  {
    id: 'view.cycleViewMode',
    title: 'Cycle View Mode',
    run: ({ store }) => {
      const e = store().settings.editor
      const next = e.viewMode === 'live' ? 'reading' : e.viewMode === 'reading' ? 'source' : 'live'
      store().updateSettings({ editor: { ...e, viewMode: next } })
    }
  },
  {
    // Kept for the "Source Mode" menu item + existing shortcut: toggle
    // between source (edit) and hybrid (live).
    id: 'view.toggleSourceMode',
    title: 'Toggle Source Mode',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({
        editor: { ...e, viewMode: e.viewMode === 'source' ? 'live' : 'source' }
      })
    }
  },
  {
    id: 'view.toggleTypewriter',
    title: 'Toggle Typewriter Mode',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({ editor: { ...e, typewriter: !e.typewriter } })
    }
  },
  {
    id: 'view.toggleFocusMode',
    title: 'Toggle Focus Mode',
    run: ({ store }) => {
      const e = store().settings.editor
      store().updateSettings({ editor: { ...e, focusMode: !e.focusMode } })
    }
  },
  {
    id: 'view.toggleReflow',
    title: 'Toggle Reflow Paragraphs',
    run: ({ store }) => {
      const m = store().settings.markdown
      store().updateSettings({ markdown: { ...m, reflowParagraphs: !m.reflowParagraphs } })
    }
  },
  {
    id: 'note.openToday',
    title: "Open Today's Daily Note",
    run: () => void openDailyNote()
  },
  {
    id: 'canvas.new',
    title: 'New Canvas',
    run: () => void newCanvas()
  },
  {
    id: 'canvas.fromCluster',
    title: "Canvas from This Note's Cluster",
    run: () => void canvasFromCluster()
  },
  {
    id: 'note.clusterMoc',
    title: "Map of Content for This Note's Cluster",
    run: () => void clusterMoc()
  },
  {
    id: 'note.insertTemplate',
    title: 'Insert Template…',
    run: ({ store }) => store().openPalette('templates')
  },
  {
    id: 'view.toggleGraph',
    title: 'Open Graph View',
    run: ({ store }) => store().toggleGraph()
  },
  {
    id: 'view.toggleAnalytics',
    title: 'Open Vault Analytics',
    run: ({ store }) => store().toggleAnalytics()
  },
  {
    id: 'file.exportHtml',
    title: 'Export as HTML…',
    run: async ({ store, view }) => {
      const v = view()
      const active = store().activeId ? store().buffers[store().activeId!] : null
      if (!v || !active) return
      const title = stem(active.fileName)
      try {
        await invoke('export:html', { title, markdown: v.state.doc.toString() })
      } catch (err) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  },
  {
    id: 'file.exportPdf',
    title: 'Export as PDF…',
    run: async ({ store, view }) => {
      const v = view()
      const active = store().activeId ? store().buffers[store().activeId!] : null
      if (!v || !active) return
      const title = stem(active.fileName)
      try {
        await invoke('export:pdf', { title, markdown: v.state.doc.toString() })
      } catch (err) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  },
  {
    id: 'app.quickOpen',
    title: 'Quick Open Note',
    run: ({ store }) => store().openPalette('files')
  },
  {
    id: 'app.commandPalette',
    title: 'Command Palette',
    run: ({ store }) => store().openPalette('commands')
  },
  {
    id: 'format.unwrapParagraphs',
    title: 'Unwrap Hard-Wrapped Paragraphs',
    run: ({ view }) => {
      const v = view()
      if (!v) return
      // Whole document when nothing is selected; otherwise the selection.
      const { from, to } = v.state.selection.main
      const [start, end] = from === to ? [0, v.state.doc.length] : [from, to]
      const reflowed = unwrapParagraphs(v.state.sliceDoc(start, end))
      if (reflowed !== v.state.sliceDoc(start, end)) {
        v.dispatch({ changes: { from: start, to: end, insert: reflowed } })
      }
    }
  },
  {
    id: 'note.extractSelection',
    title: 'Extract Selection to Note',
    run: async ({ store, view }) => {
      const v = view()
      const root = store().rootPath
      if (!v || !root) return
      const { from, to } = v.state.selection.main
      if (from === to) return
      const content = v.state.sliceDoc(from, to)
      // Name from the first few words of the selection.
      const name =
        content
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(' ')
          .replace(/[\\/:*?"<>|#[\]]/g, '')
          .slice(0, 60) || 'Extracted note'
      try {
        const node = await invoke('fs:createFile', { dirPath: root, name: `${name}.md` })
        await invoke('fs:writeFile', {
          path: node.path,
          content: `# ${name}\n\n${content.trim()}\n`,
          expectedMtimeMs: null
        })
        v.dispatch({ changes: { from, to, insert: `[[${stem(node.path)}]]` } })
        await store().refreshTree()
      } catch (err) {
        window.alert(`Could not extract note: ${err instanceof Error ? err.message : err}`)
      }
    }
  },
  {
    id: 'format.highlight',
    title: 'Highlight Selection',
    run: ({ view }) => {
      const v = view()
      if (v) {
        toggleHighlight(v)
        v.focus()
      }
    }
  },
  {
    id: 'find.open',
    title: 'Find',
    run: ({ view }) => {
      const v = view()
      if (v) {
        openSearchPanel(v)
        v.focus()
      }
    }
  },
  {
    id: 'find.replace',
    title: 'Replace',
    run: ({ view }) => {
      const v = view()
      if (v) {
        openSearchPanel(v)
        replaceNext(v)
      }
    }
  }
]
