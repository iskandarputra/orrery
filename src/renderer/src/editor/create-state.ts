import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers
} from '@codemirror/view'
import type { Settings } from '@shared/settings'
import { docPathFacet } from './doc-context'
import { toggleHighlight } from './inline-format'
import { HighlightExtension } from './markdown/highlight-extension'
import { focusMode, typewriterMode } from './modes'
import { reflowParagraphs } from './live-preview/reflow-view'
import { pluginEditorExtensions } from '@/plugins/registry'
import { scheduleStatsUpdate } from '@/state/editor-stats'
import { bufferRegistry } from './buffer-registry'
import { livePreview } from './live-preview'
import { zymdEditorTheme } from './theme'

/**
 * Compartments allow live reconfiguration (settings changes) without
 * recreating states. They are shared keys — each EditorState instance tracks
 * its own content for them.
 */
export const settingsCompartment = new Compartment()

export function settingsExtensions(settings: Settings): Extension {
  const e = settings.editor
  const rendered = e.viewMode !== 'source' // 'live' and 'reading' both render
  const reading = e.viewMode === 'reading' // fully rendered, read-only
  // In Reading mode (pure preview), always render markdown and reflow paragraphs like VS Code.
  const showLivePreview = reading || (settings.markdown.livePreview && rendered)
  const reflow = reading || (showLivePreview && settings.markdown.reflowParagraphs)
  return [
    e.wordWrap || reflow ? EditorView.lineWrapping : [],
    e.lineNumbers && !reading ? lineNumbers() : [],
    e.highlightActiveLine && !reading ? highlightActiveLine() : [],
    e.typewriter && !reading ? typewriterMode() : [],
    e.focusMode && !reading ? focusMode() : [],
    EditorState.tabSize.of(e.tabSize),
    indentUnit.of(' '.repeat(e.tabSize)),
    showLivePreview
      ? livePreview({
          fancyBullets: settings.markdown.fancyBullets,
          interactiveCheckboxes: settings.markdown.interactiveCheckboxes,
          showImages: settings.markdown.showImages,
          // Reading mode renders statically — clicking never reveals raw source.
          reveal: !reading
        })
      : [],
    reflow ? reflowParagraphs() : [],
    // Reading mode: no cursor, no edits — a clean rendered document.
    reading ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [],
    pluginEditorExtensions(settings)
  ]
}

export interface CreateDocumentStateOptions {
  id: string
  content: string
  settings: Settings
  /** Filesystem path — lets image rendering resolve relative asset paths. */
  filePath?: string | null
  onDirtyChange(dirty: boolean): void
}

/** Build the complete EditorState for a document buffer. */
export function createDocumentState(options: CreateDocumentStateOptions): EditorState {
  const { id, content, settings, filePath = null, onDirtyChange } = options

  return EditorState.create({
    doc: content,
    extensions: [
      docPathFacet.of(filePath),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      markdown({
        base: markdownLanguage, // GFM: tables, task lists, strikethrough, autolink
        codeLanguages: languages,
        extensions: [HighlightExtension]
      }),
      zymdEditorTheme(),
      search({ top: true }),
      keymap.of([
        { key: 'Mod-Shift-h', run: toggleHighlight },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...markdownKeymap,
        indentWithTab
      ]),
      settingsCompartment.of(settingsExtensions(settings)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onDirtyChange(bufferRegistry.isDirty(id, update.state.doc))
        }
        if (update.docChanged || update.selectionSet) {
          scheduleStatsUpdate(update.state)
        }
      })
    ]
  })
}
