import { useEffect, useState } from 'react'
import { EMPTY_DIFF, alignHunk, type DiffLine, type FileDiff } from '@core/unified-diff'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

/**
 * One side of a row. An empty cell is padding that keeps the columns aligned.
 *
 * The right column is the working tree, so its lines are editable — that is the
 * copy on disk. The left column never is: it is either HEAD or the index, and
 * neither is a file you can write through. A removed line has no counterpart in
 * the working tree, so it is not editable even on the right.
 */
function Cell({
  line,
  side,
  editable,
  onEdit
}: {
  line: DiffLine | null
  side: 'left' | 'right'
  editable: boolean
  onEdit: (lineNumber: number, text: string) => void
}): React.JSX.Element {
  if (!line) return <div className="diff__cell diff__cell--empty" />
  const number = side === 'left' ? line.oldLine : line.newLine
  const canEdit = editable && side === 'right' && line.newLine !== null

  return (
    <div className={`diff__cell diff__cell--${line.kind}`}>
      <span className="diff__num">{number ?? ''}</span>
      <span className="diff__sign">
        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
      </span>
      {/* Rendered as text, never as markup: this is file content. */}
      <span
        className={`diff__text${canEdit ? ' diff__text--editable' : ''}`}
        contentEditable={canEdit}
        suppressContentEditableWarning
        spellCheck={false}
        role={canEdit ? 'textbox' : undefined}
        aria-label={canEdit ? `Line ${line.newLine}` : undefined}
        onBlur={(e) => {
          if (canEdit) onEdit(line.newLine!, e.currentTarget.textContent ?? '')
        }}
        onKeyDown={(e) => {
          // Enter commits the line rather than inserting a paragraph; Escape
          // puts back what was there.
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.currentTarget.textContent = line.text
            e.currentTarget.blur()
          }
        }}
      >
        {line.text || ' '}
      </span>
    </div>
  )
}

/**
 * What changed in one file, side by side.
 *
 * The old file on the left, the working tree on the right, aligned so a
 * replaced line sits opposite the line that replaced it. "Edit" opens the file
 * in the editor, where the full editing machinery already lives — putting a
 * second editor inside the diff would mean two places holding unsaved changes
 * to one file.
 */
export function DiffView({ bufferId }: { bufferId: string }): React.JSX.Element | null {
  const target = useStore((s) => s.buffers[bufferId]?.diff ?? null)
  const closeTab = useStore((s) => s.closeTab)
  const rootPath = useStore((s) => s.rootPath)
  const close = (): void => void closeTab(bufferId)
  /** null while the diff for the current target is still being read. */
  const [diff, setDiff] = useState<FileDiff | null>(null)

  // Reset during render rather than in the effect: opening a different file
  // must not show the previous file's diff for a frame, and setting state
  // synchronously inside an effect costs a second render pass.
  const [reloadToken, setReloadToken] = useState(0)
  const [shown, setShown] = useState(target)
  if (target !== shown) {
    setShown(target)
    setDiff(null)
  }

  useEffect(() => {
    if (!target || !rootPath) return
    let live = true
    void invoke('git:fileDiff', { rootPath, path: target.path, staged: target.staged })
      .then((result) => live && setDiff(result))
      .catch(() => live && setDiff(EMPTY_DIFF))
    return () => {
      live = false
    }
  }, [target, rootPath, reloadToken])

  if (!target) return null

  /**
   * Open the file for editing. The right column is the working tree, so that is
   * the copy the editor gets; a staged snapshot is not something git can
   * round-trip an edit through.
   */
  /**
   * Write one edited line back to the file on disk.
   *
   * Whole lines only, and only lines the working tree has — this edits the
   * file, it does not reconstruct one from the diff, which describes changed
   * regions and nothing else.
   *
   * The read supplies the mtime the write is checked against, so a line edited
   * here cannot silently clobber a change made in the editor a moment earlier.
   */
  const editLine = (lineNumber: number, text: string): void => {
    if (!rootPath) return
    void (async () => {
      const absolute = await invoke('git:absolutePath', { rootPath, path: target.path })
      try {
        const file = await invoke('fs:readFile', { path: absolute })
        const lines = file.content.split('\n')
        if (lines[lineNumber - 1] === text) return // nothing actually changed
        lines[lineNumber - 1] = text
        await invoke('fs:writeFile', {
          path: absolute,
          content: lines.join('\n'),
          expectedMtimeMs: file.mtimeMs
        })
      } catch {
        useStore
          .getState()
          .showToast('Could not save that line — the file changed on disk', 'error')
      }
      setReloadToken((n) => n + 1)
    })()
  }

  const openInEditor = async (): Promise<void> => {
    if (!rootPath) return
    const absolute = await invoke('git:absolutePath', { rootPath, path: target.path })
    await useStore.getState().openPaths([absolute])
    close()
  }

  return (
    <div className="diff" role="region" aria-label={`Changes in ${target.path}`}>
      <div className="diff__bar">
        <span className="diff__path" title={target.path}>
          {target.path}
        </span>
        <span className="diff__side">{target.staged ? 'staged' : 'working tree'}</span>
        <span className="diff__stat diff__stat--added">+{diff?.added ?? 0}</span>
        <span className="diff__stat diff__stat--removed">-{diff?.removed ?? 0}</span>
        <button
          className="diff__edit"
          title="Open this file in the editor"
          onClick={() => void openInEditor()}
        >
          <Icon name="pencil" size={13} /> Edit
        </button>
        <button className="icon-btn" aria-label="Close" title="Close this tab" onClick={close}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="diff__heads">
        <span className="diff__head">{target.staged ? 'HEAD' : 'staged'}</span>
        <span className="diff__head">
          {target.staged ? 'staged' : 'working tree'}
          <span className="diff__head-note">
            {target.staged ? 'read-only — unstage to edit' : 'editable'}
          </span>
        </span>
      </div>

      <div className="diff__body">
        {diff === null ? (
          <p className="diff__note">Reading the diff…</p>
        ) : diff.binary ? (
          <p className="diff__note">Binary file — there is nothing to show line by line.</p>
        ) : diff.hunks.length === 0 ? (
          <p className="diff__note">No changes in this file.</p>
        ) : (
          diff.hunks.map((hunk, h) => (
            <div className="diff__hunk" key={h}>
              <div className="diff__hunk-head">{hunk.header}</div>
              {alignHunk(hunk).map((row, i) => (
                <div className="diff__row" key={i}>
                  <Cell line={row.left} side="left" editable={false} onEdit={editLine} />
                  <Cell line={row.right} side="right" editable={!target.staged} onEdit={editLine} />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
