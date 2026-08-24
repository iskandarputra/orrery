import { useEffect, useRef, useState } from 'react'
import { basename, dirname } from '@core/paths'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import type { TreeEdit } from '@/state/ui'
import { Icon } from './Icon'

/** Inline input used for create-file / create-folder / rename in the tree. */
export function TreeEditInput({
  edit,
  indentPx
}: {
  edit: TreeEdit
  indentPx: number
}): React.JSX.Element {
  const setTreeEdit = useStore((s) => s.setTreeEdit)
  const refreshTree = useStore((s) => s.refreshTree)
  const openPaths = useStore((s) => s.openPaths)
  const updatePathsAfterRename = useStore((s) => s.updatePathsAfterRename)
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (edit.type === 'rename' && edit.initialValue) {
      const dot = edit.initialValue.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : edit.initialValue.length)
    }
  }, [edit])

  const submit = async (): Promise<void> => {
    if (doneRef.current) return
    const raw = inputRef.current?.value.trim()
    if (!raw || raw === edit.initialValue) {
      doneRef.current = true
      setTreeEdit(null)
      return
    }
    try {
      if (edit.type === 'create-file') {
        const name = /\.[A-Za-z0-9]+$/.test(raw) ? raw : `${raw}.md`
        const node = await invoke('fs:createFile', { dirPath: edit.dirPath, name })
        await refreshTree()
        await openPaths([node.path])
      } else if (edit.type === 'create-dir') {
        await invoke('fs:createDirectory', { dirPath: edit.dirPath, name: raw })
        await refreshTree()
      } else if (edit.path) {
        const newPath = await invoke('fs:rename', { path: edit.path, newName: raw })
        updatePathsAfterRename(edit.path, newPath)
        await refreshTree()
      }
      doneRef.current = true
      setTreeEdit(null)
    } catch (err) {
      setError(parseIpcError(err).message)
      inputRef.current?.select()
    }
  }

  return (
    <div className="tree-newfile" style={{ marginLeft: indentPx }}>
      <Icon
        name={edit.type === 'create-dir' ? 'folder' : 'file-text'}
        size={15}
        className="tree-icon"
      />
      <input
        ref={inputRef}
        defaultValue={edit.initialValue ?? ''}
        placeholder={edit.type === 'create-dir' ? 'folder name' : 'filename.md'}
        aria-invalid={!!error}
        title={error ?? undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            doneRef.current = true
            setTreeEdit(null)
          }
        }}
        onBlur={() => void submit()}
      />
    </div>
  )
}

/** Close clean buffers whose file (or ancestor folder) was deleted. */
export function closeBuffersUnder(path: string): void {
  const { buffers, closeTab } = useStore.getState()
  for (const buffer of Object.values(buffers)) {
    if (!buffer.filePath || buffer.isDirty) continue
    if (buffer.filePath === path || buffer.filePath.startsWith(path + '/')) {
      void closeTab(buffer.id)
    }
  }
}

export function editNameOf(path: string): { dirPath: string; initialValue: string } {
  return { dirPath: dirname(path), initialValue: basename(path) }
}
