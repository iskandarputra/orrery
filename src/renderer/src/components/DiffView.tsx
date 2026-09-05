import { useEffect, useRef, useState } from 'react'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { alignFile, changedLines, changeMarks, padding } from '@core/diff-align'
import { resizePanes, toColumns } from '@core/pane-sizes'
import { EMPTY_DIFF, type FileDiff } from '@core/unified-diff'
import { languageCompartment, findLanguage } from '@/editor/code-language'
import { diffMarks, setDiffMarks } from '@/editor/diff-decorations'
import { minimap } from '@/editor/minimap'
import { markdownHighlight, orreryEditorTheme } from '@/editor/theme'
import { documentTypography } from '@/editor/typography'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

/**
 * The minimap's bands. The same tokens the changed lines are tinted with, so
 * the preview and the text agree, and a theme change carries both.
 */
const MARK_COLOURS = { added: 'var(--or-diff-add)', removed: 'var(--or-diff-del)' } as const

/** The divider's own grid track, matching the one between editor panes. */
const DIVIDER = '5px'

/** Lines in a string, counting the way a file does. */
const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length)

/**
 * One pane of the diff: a real editor, not a rendering of one.
 *
 * This is the whole point of the rewrite. The panes used to be a stack of
 * one-line `contentEditable` spans, which meant no syntax highlighting, no
 * selection across lines, no undo, Enter committing instead of inserting, and
 * nothing editable except the lines that had already changed. An editor gives
 * all of that back for free, and gives it back identically to the editor the
 * rest of the app uses, because it is the same one.
 */
function paneExtensions(editable: boolean, mini: Extension = []): Extension {
  return [
    mini,
    lineNumbers(),
    history(),
    diffMarks,
    syntaxHighlighting(markdownHighlight, { fallback: true }),
    orreryEditorTheme(),
    languageCompartment.of([]),
    editable ? [bracketMatching(), closeBrackets(), indentOnInput(), highlightActiveLine()] : [],
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.editable.of(editable),
    EditorState.readOnly.of(!editable),
    EditorView.theme({ '&': { height: '100%' } })
  ]
}

/**
 * What changed in one file, side by side.
 *
 * Old on the left, new on the right, held level by blank space where one file
 * has lines the other does not. The right pane is the working tree and is
 * editable; the left is HEAD or the index, and neither of those is a file you
 * can write through. A staged diff is read-only on both sides for the same
 * reason — git cannot round-trip an edit back into the index from here.
 */
export function DiffView({ bufferId }: { bufferId: string }): React.JSX.Element | null {
  const target = useStore((s) => s.buffers[bufferId]?.diff ?? null)
  const closeTab = useStore((s) => s.closeTab)
  const setDirty = useStore((s) => s.setDirty)
  const rootPath = useStore((s) => s.rootPath)
  const editorSettings = useStore((s) => s.settings.editor)
  const showMinimap = editorSettings.minimap
  const split = useStore((s) => s.settings.diff.split)
  const setDiffSplit = useStore((s) => s.setDiffSplit)
  const close = (): void => void closeTab(bufferId)

  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dirty, setLocalDirty] = useState(false)
  const [shown, setShown] = useState(target)

  const leftHost = useRef<HTMLDivElement>(null)
  const rightHost = useRef<HTMLDivElement>(null)
  const panesRef = useRef<HTMLDivElement>(null)
  const headsRef = useRef<HTMLDivElement>(null)
  const leftView = useRef<EditorView | null>(null)
  const rightView = useRef<EditorView | null>(null)
  /** mtime the working tree was read at, so a save cannot clobber a newer one. */
  const mtimeRef = useRef<number | null>(null)
  const savingRef = useRef(false)

  if (target !== shown) {
    setShown(target)
    setDiff(null)
  }

  // A commit is history: it can be read, and it cannot be written to.
  const editable = !!target && !target.staged && !target.commit

  /** Write the right pane back to disk. */
  const save = async (): Promise<void> => {
    const view = rightView.current
    if (!view || !rootPath || !target || savingRef.current) return
    savingRef.current = true
    try {
      const absolute = await invoke('git:absolutePath', { rootPath, path: target.path })
      await invoke('fs:writeFile', {
        path: absolute,
        content: view.state.doc.toString(),
        expectedMtimeMs: mtimeRef.current
      })
      setLocalDirty(false)
      setDirty(bufferId, false)
      // Re-read so the marks describe what is now on disk rather than what was.
      setReloadToken((n) => n + 1)
    } catch {
      useStore.getState().showToast('Could not save — the file changed on disk', 'error')
    } finally {
      savingRef.current = false
    }
  }
  // Held in a ref, and updated after render rather than during it: the save
  // keymap is installed once when the panes are built, but it has to call the
  // current save, which closes over state that changes.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  // Build both panes whenever the target file or its content changes.
  useEffect(() => {
    if (!target || !rootPath) return
    let live = true

    void (async () => {
      const [contents, parsed] = await Promise.all([
        invoke('git:fileContents', {
          rootPath,
          path: target.path,
          staged: target.staged,
          commit: target.commit
        }),
        invoke('git:fileDiff', {
          rootPath,
          path: target.path,
          staged: target.staged,
          commit: target.commit
        }).catch(() => EMPTY_DIFF)
      ])
      if (!live || !leftHost.current || !rightHost.current) return
      setDiff(parsed)

      // The mtime the edit is checked against. Read after the content so a save
      // is compared with the same revision the pane was filled from.
      if (!target.staged && !target.commit) {
        try {
          const absolute = await invoke('git:absolutePath', { rootPath, path: target.path })
          mtimeRef.current = (await invoke('fs:readFile', { path: absolute })).mtimeMs
        } catch {
          mtimeRef.current = null
        }
      }
      if (!live) return

      const rows = alignFile(parsed, lineCount(contents.old), lineCount(contents.new))
      const pads = padding(rows, lineCount(contents.old), lineCount(contents.new))
      const changed = changedLines(rows)

      leftView.current?.destroy()
      rightView.current?.destroy()

      const left = new EditorView({
        state: EditorState.create({
          doc: contents.old,
          extensions: paneExtensions(false)
        }),
        parent: leftHost.current
      })
      const right = new EditorView({
        state: EditorState.create({
          doc: contents.new,
          extensions: [
            // One minimap, on the working-tree side, as VS Code's diff editor
            // has: two in half-width panes would cost a quarter of the view to
            // say the same thing twice. It bands the changed lines, so the shape
            // of the edit is visible without scrolling the file — deletions
            // included, marked on the line that replaced them, since this side
            // has no line of their own to mark.
            paneExtensions(
              editable,
              minimap(showMinimap, {
                changes: Object.fromEntries(
                  changeMarks(rows).map((mark) => [mark.line, MARK_COLOURS[mark.kind]])
                )
              })
            ),
            // Ahead of the default keymap so Mod-s is a save and never a browser
            // save dialog or an insertion.
            Prec.high(
              keymap.of([
                {
                  key: 'Mod-s',
                  run: () => {
                    void saveRef.current()
                    return true
                  }
                }
              ])
            ),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return
              setLocalDirty(true)
              setDirty(bufferId, true)
            })
          ]
        }),
        parent: rightHost.current
      })

      left.dispatch({
        effects: setDiffMarks.of({ changed: changed.removed, padding: pads.left, side: 'old' })
      })
      right.dispatch({
        effects: setDiffMarks.of({ changed: changed.added, padding: pads.right, side: 'new' })
      })

      // Syntax highlighting for whatever language the file is, loaded lazily so
      // the grammar is not in the bundle for files that never open.
      const desc = findLanguage(target.path)
      if (desc) {
        void desc.load().then((support) => {
          if (!live) return
          left.dispatch({ effects: languageCompartment.reconfigure(support) })
          right.dispatch({ effects: languageCompartment.reconfigure(support) })
        })
      }

      leftView.current = left
      rightView.current = right
      setLocalDirty(false)
      syncScroll(left, right)
    })()

    return () => {
      live = false
      leftView.current?.destroy()
      rightView.current?.destroy()
      leftView.current = null
      rightView.current = null
    }
  }, [target, rootPath, reloadToken, editable, bufferId, setDirty, showMinimap])

  if (!target) return null

  const columns = (share: number): string => toColumns([share, 1 - share], DIVIDER)

  /**
   * Drag the boundary between the two columns.
   *
   * Written to the elements during the drag and saved once at the end. The
   * share is a setting, and a setting written per pixel of movement is a store
   * update, a re-render, an IPC message and a debounced disk write per pixel —
   * which is what made the sidebar feel like it was catching up rather than
   * following.
   */
  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const host = panesRef.current
    if (!host) return
    const width = host.getBoundingClientRect().width
    const startX = event.clientX
    let latest = split

    const onMove = (move: MouseEvent): void => {
      latest = resizePanes([split, 1 - split], 0, (move.clientX - startX) / width)[0]!
      host.style.gridTemplateColumns = columns(latest)
      if (headsRef.current) headsRef.current.style.gridTemplateColumns = columns(latest)
    }
    const onUp = (): void => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDiffSplit(latest)
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The keyboard path, because a divider is five pixels wide and a mouse is not
  // the only way anyone works.
  const onDividerKey = (event: React.KeyboardEvent): void => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === 'ArrowLeft') setDiffSplit(resizePanes([split, 1 - split], 0, -step)[0]!)
    else if (event.key === 'ArrowRight') setDiffSplit(resizePanes([split, 1 - split], 0, step)[0]!)
    else if (event.key === 'Home' || event.key === 'Enter') setDiffSplit(0.5)
    else return
    event.preventDefault()
  }

  const openInEditor = async (): Promise<void> => {
    if (!rootPath) return
    const absolute = await invoke('git:absolutePath', { rootPath, path: target.path })
    await useStore.getState().openPaths([absolute])
    close()
  }

  return (
    <div
      className="diff"
      role="region"
      aria-label={`Changes in ${target.path}`}
      /**
       * A diff is two text documents, so it is set the way text is set.
       *
       * The panes are CodeMirror and read their size, face and measure from
       * these — but they sit outside the editor's own element, which is where
       * the variables used to be declared, so they fell back to the defaults in
       * `tokens.css`: a fixed 16px in the prose face, no matter what the
       * settings said. Page zoom moved the number and nothing on screen
       * changed, which is the same failure the tables and the HTML reader had.
       *
       * Always `code`, whatever the file is. A diff is read down its left edge
       * against the indentation, in two columns that have to line up with each
       * other — that is true of a diff of a markdown note as much as of one of
       * a source file.
       */
      style={documentTypography(editorSettings, 'code')}
    >
      <div className="diff__bar">
        <span className="diff__path" title={target.path}>
          {target.path}
        </span>
        <span className="diff__side">
          {target.commit ? target.commit.slice(0, 7) : target.staged ? 'staged' : 'working tree'}
        </span>
        <span className="diff__stat diff__stat--added">+{diff?.added ?? 0}</span>
        <span className="diff__stat diff__stat--removed">-{diff?.removed ?? 0}</span>
        {editable && (
          <button
            className="diff__edit"
            title="Save changes (Ctrl+S)"
            disabled={!dirty}
            onClick={() => void saveRef.current()}
          >
            <Icon name="download" size={13} /> {dirty ? 'Save' : 'Saved'}
          </button>
        )}
        <button
          className="diff__edit"
          title="Open this file in the editor"
          onClick={() => void openInEditor()}
        >
          <Icon name="pencil" size={13} /> Open
        </button>
        <button className="icon-btn" aria-label="Close" title="Close this tab" onClick={close}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="diff__heads" ref={headsRef} style={{ gridTemplateColumns: columns(split) }}>
        <span className="diff__head">
          {target.commit ? 'parent' : target.staged ? 'HEAD' : 'staged'}
        </span>
        <span className="diff__head-gap" aria-hidden="true" />
        <span className="diff__head">
          {target.commit ? 'this commit' : target.staged ? 'staged' : 'working tree'}
          <span className="diff__head-note">
            {target.commit
              ? 'read-only, history'
              : target.staged
                ? 'read-only, unstage to edit'
                : 'editable'}
          </span>
        </span>
      </div>

      <div className="diff__panes" ref={panesRef} style={{ gridTemplateColumns: columns(split) }}>
        <div className="diff__pane" ref={leftHost} />
        <div
          className="pane-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the diff columns"
          aria-valuenow={Math.round(split * 100)}
          aria-valuemin={12}
          aria-valuemax={88}
          tabIndex={0}
          title="Drag to resize. Double-click for equal columns."
          onMouseDown={startResize}
          onDoubleClick={() => setDiffSplit(0.5)}
          onKeyDown={onDividerKey}
        />
        <div className="diff__pane diff__pane--new" ref={rightHost} />
      </div>

      {diff?.binary && (
        <p className="diff__note">Binary file — there is nothing to show line by line.</p>
      )}
    </div>
  )
}

/**
 * Keep the two panes level.
 *
 * A guard flag rather than a comparison: setting one pane's scrollTop fires its
 * own scroll event, and without the flag each pane would chase the other for as
 * long as the momentum lasted.
 */
function syncScroll(left: EditorView, right: EditorView): void {
  let echo = false
  const link = (from: EditorView, to: EditorView): void => {
    from.scrollDOM.addEventListener(
      'scroll',
      () => {
        if (echo) return
        echo = true
        to.scrollDOM.scrollTop = from.scrollDOM.scrollTop
        to.scrollDOM.scrollLeft = from.scrollDOM.scrollLeft
        requestAnimationFrame(() => {
          echo = false
        })
      },
      { passive: true }
    )
  }
  link(left, right)
  link(right, left)
}
