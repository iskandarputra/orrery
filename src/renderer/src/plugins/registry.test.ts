import { describe, expect, it } from 'vitest'
import { activatePlugins, surfaceForFile, surfaceForKind } from './registry'
import type { DocumentSurface, OrreryPlugin } from './api'
import { useStore } from '@/state/store'

/**
 * The surface registry, exercised with surfaces that are not Excalidraw.
 *
 * Excalidraw's own tests prove the path works end to end; these prove the path
 * is general — that the API is a seam and not a hole shaped like one plugin.
 */

const noop = (): void => {}
const surface = (id: string, pattern: RegExp): DocumentSurface => ({
  id,
  label: id,
  claims: (name) => pattern.test(name),
  Component: () => null as unknown as React.JSX.Element
})

const pluginFor = (...surfaces: DocumentSurface[]): OrreryPlugin => ({
  id: `test-${surfaces.map((s) => s.id).join('-')}`,
  name: 'test',
  activate: (ctx) => surfaces.forEach((s) => ctx.registerDocumentSurface(s))
})

const activate = (plugin: OrreryPlugin): void =>
  activatePlugins([plugin], { registerCommand: noop, store: useStore })

describe('document surfaces', () => {
  it('claims a file for the plugin that registered it', () => {
    activate(pluginFor(surface('drawio', /\.drawio$/i)))
    expect(surfaceForFile('Diagram.drawio')?.id).toBe('drawio')
    expect(surfaceForKind('drawio')?.label).toBe('drawio')
  })

  it('leaves files nothing claims to the built-in classification', () => {
    expect(surfaceForFile('notes.md')).toBeNull()
    expect(surfaceForFile('main.rs')).toBeNull()
  })

  it('holds more than one surface at a time', () => {
    activate(pluginFor(surface('pdf', /\.pdf$/i), surface('notebook', /\.ipynb$/i)))
    expect(surfaceForFile('paper.pdf')?.id).toBe('pdf')
    expect(surfaceForFile('analysis.ipynb')?.id).toBe('notebook')
  })

  it('refuses a second surface with an id already taken', () => {
    // Two surfaces answering to one id is a conflict the user can neither see
    // nor resolve; the first registration keeps the name.
    activate(pluginFor(surface('dup', /\.one$/)))
    activate(pluginFor({ ...surface('dup', /\.two$/), label: 'second' }))
    expect(surfaceForKind('dup')?.label).toBe('dup')
    expect(surfaceForFile('x.two')).toBeNull()
  })

  it('reports no surface for a kind that is not one', () => {
    expect(surfaceForKind('markdown')).toBeNull()
    expect(surfaceForKind('code')).toBeNull()
  })
})
