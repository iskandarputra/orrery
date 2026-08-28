import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import type { Settings } from '@shared/settings'
import { documentKind, type DocumentKind } from '@core/document-kind'
import { languageCompartment } from './code-language'
import { gitGutter } from './git-gutter'
import { docPathFacet } from './doc-context'
import { toggleHighlight } from './inline-format'
import { HighlightExtension } from './markdown/highlight-extension'
import { blockHandles } from './block-handles'
import { blockMoveKeymap } from './block-move'
import { focusMode, typewriterMode } from './modes'
import { pasteAssets } from './paste-assets'
import { reflowField, reflowParagraphs } from './live-preview/reflow-view'
import { pluginEditorExtensions } from '@/plugins/registry'
import { bumpDocVersion } from '@/state/doc-version'
import { scheduleStatsUpdate } from '@/state/editor-stats'
import { bufferRegistry } from './buffer-registry'
import { livePreview } from './live-preview'
import { orreryEditorTheme } from './theme'

/**
 * Compartments allow live reconfiguration (settings changes) without
 * recreating states. They are shared keys — each EditorState instance tracks
 * its own content for them.
 */
export const settingsCompartment = new Compartment()

/**
 * The editing behaviours a source file wants and a note does not: a gutter to
 * navigate by, brackets that close and match, folding, and indentation that
 * reacts to what you type. None of these were wired up anywhere before, because
 * until now every buffer was markdown.
 */
function codeExtensions(settings: Settings): Extension {
  const e = settings.editor
  return [
    // Wrapping is off by default for code — a wrapped line breaks the column
    // alignment that indentation and ASCII tables depend on — but honoured when
    // the setting is on, since that is what the setting says.
    e.wordWrap ? EditorView.lineWrapping : [],
    lineNumbers(),
    highlightActiveLineGutter(),
    gitGutter(),
    highlightActiveLine(),
    foldGutter(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    highlightSelectionMatches(),
    EditorState.tabSize.of(e.tabSize),
    indentUnit.of(' '.repeat(e.tabSize)),
    keymap.of([...closeBracketsKeymap, ...foldKeymap])
  ]
}

export function settingsExtensions(settings: Settings, kind: DocumentKind = 'markdown'): Extension {
  const e = settings.editor
  // Code is not prose: none of the markdown machinery below applies to it, and
  // most of it actively misreads it.
  if (kind === 'code') return codeExtensions(settings)
  const rendered = e.viewMode !== 'source' // 'live' and 'reading' both render
  const reading = e.viewMode === 'reading' // fully rendered, read-only
  // In Reading mode (pure preview), always render markdown and reflow paragraphs like VS Code.
  const showLivePreview = reading || (settings.markdown.livePreview && rendered)
  const reflow = reading || (showLivePreview && settings.markdown.reflowParagraphs)
  return [
    e.wordWrap || reflow ? EditorView.lineWrapping : [],
    e.lineNumbers && !reading ? lineNumbers() : [],
    // Handles are for editing; a rendered document has nothing to drag.
    reading ? [] : blockHandles(),
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
    reflowParagraphs(reflow),
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
  /** Defaults to what the file name implies; untitled buffers are markdown. */
  kind?: DocumentKind
  onDirtyChange(dirty: boolean): void
}

/** Build the complete EditorState for a document buffer. */
export function createDocumentState(options: CreateDocumentStateOptions): EditorState {
  const { id, content, settings, filePath = null, onDirtyChange } = options
  const kind = options.kind ?? (filePath ? documentKind(filePath) : 'markdown')
  const isCode = kind === 'code'

  return EditorState.create({
    doc: content,
    extensions: [
      docPathFacet.of(filePath),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      isCode
        ? // Filled in once the grammar has loaded; see code-language.ts.
          languageCompartment.of([])
        : markdown({
            base: markdownLanguage, // GFM: tables, task lists, strikethrough, autolink
            codeLanguages: languages,
            extensions: [HighlightExtension]
          }),
      orreryEditorTheme(),
      // CodeMirror disables spellcheck by default; prose wants it on, and
      // Electron's checker supplies the underline and the suggestions. Code
      // does not: every identifier would be underlined as a misspelling.
      EditorView.contentAttributes.of({ spellcheck: isCode ? 'false' : 'true' }),
      // Pasting an image into a note files it as an asset and links it. In a
      // source file that is never what was meant.
      isCode ? [] : pasteAssets(),
      isCode ? [] : reflowField,
      search({ top: true }),
      keymap.of([
        ...(isCode
          ? []
          : // List continuation, block moves and the highlight shortcut are all
            // markdown editing gestures.
            [{ key: 'Mod-Shift-h', run: toggleHighlight }, ...blockMoveKeymap, ...markdownKeymap]),
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab
      ]),
      settingsCompartment.of(settingsExtensions(settings, kind)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onDirtyChange(bufferRegistry.isDirty(id, update.state.doc))
          // Views rendered from the document (the canvas) re-read on this.
          bumpDocVersion(id)
        }
        if (update.docChanged || update.selectionSet) {
          scheduleStatsUpdate(update.state)
        }
      })
    ]
  })
}
