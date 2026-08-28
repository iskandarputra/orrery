import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { toCodeMirrorDiagnostics } from './lsp-diagnostics'
import type { LspDiagnostic } from '@shared/types'

const DOC = 'const a = 1\nconst b = 2\nconst c = 3\n'
const state = EditorState.create({ doc: DOC })

const diag = (over: Partial<LspDiagnostic> = {}): LspDiagnostic => ({
  startLine: 0,
  startChar: 0,
  endLine: 0,
  endChar: 5,
  severity: 'error',
  message: 'boom',
  ...over
})

describe('toCodeMirrorDiagnostics', () => {
  it('converts zero-based line/character into document offsets', () => {
    // Line 1 (0-based) is "const b = 2", which starts at offset 12.
    const [d] = toCodeMirrorDiagnostics(state, [
      diag({ startLine: 1, startChar: 6, endLine: 1, endChar: 7 })
    ])
    expect(d).toMatchObject({ from: 18, to: 19, severity: 'error' })
  })

  it('shows a hint as info, since CodeMirror has no hint level', () => {
    expect(toCodeMirrorDiagnostics(state, [diag({ severity: 'hint' })])[0]!.severity).toBe('info')
  })

  it('widens a zero-width range so it draws something', () => {
    const [d] = toCodeMirrorDiagnostics(state, [
      diag({ startLine: 0, startChar: 3, endLine: 0, endChar: 3 })
    ])
    expect(d!.to).toBeGreaterThan(d!.from)
  })

  it('clamps a position the document no longer has', () => {
    // Diagnostics arrive asynchronously; the file can shrink under them, and an
    // unclamped offset throws inside CodeMirror rather than drawing nothing.
    const [d] = toCodeMirrorDiagnostics(state, [
      diag({ startLine: 99, startChar: 0, endLine: 99, endChar: 4 })
    ])
    expect(d!.from).toBeLessThanOrEqual(state.doc.length)
    expect(d!.to).toBeLessThanOrEqual(state.doc.length)
  })

  it('clamps a character past the end of its line', () => {
    const [d] = toCodeMirrorDiagnostics(state, [
      diag({ startLine: 0, startChar: 500, endLine: 0, endChar: 900 })
    ])
    expect(d!.from).toBe(state.doc.line(1).to)
  })

  it('appends the source so a message says who reported it', () => {
    const [d] = toCodeMirrorDiagnostics(state, [diag({ source: 'ts' })])
    expect(d!.message).toBe('boom (ts)')
  })

  it('sorts by position, as CodeMirror requires', () => {
    const out = toCodeMirrorDiagnostics(state, [
      diag({ startLine: 2, endLine: 2 }),
      diag({ startLine: 0, endLine: 0 }),
      diag({ startLine: 1, endLine: 1 })
    ])
    expect(out.map((d) => d.from)).toEqual([...out.map((d) => d.from)].sort((a, b) => a - b))
  })

  it('returns nothing when the server reports nothing', () => {
    expect(toCodeMirrorDiagnostics(state, [])).toEqual([])
  })
})
