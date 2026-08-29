import { useStore } from '@/state/store'
import { NumberField, SegmentedControl, SettingRow, TextField, Toggle } from '../controls'

export function EditorSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const e = settings.editor

  return (
    <>
      <h3 className="set-group">Typography</h3>
      <SettingRow label="Font size">
        <NumberField
          value={e.fontSize}
          min={8}
          max={48}
          suffix="px"
          onChange={(fontSize) => update({ editor: { ...e, fontSize } })}
        />
      </SettingRow>
      <SettingRow label="Font family" description="Leave empty for the default prose font (Inter)">
        <TextField
          value={e.fontFamily}
          placeholder="Inter, Newsreader, MesloLGL Nerd Font Mono…"
          onChange={(fontFamily) => update({ editor: { ...e, fontFamily } })}
        />
      </SettingRow>
      <SettingRow label="Line height">
        <NumberField
          value={e.lineHeight}
          min={1}
          max={3}
          step={0.1}
          onChange={(lineHeight) => update({ editor: { ...e, lineHeight } })}
        />
      </SettingRow>

      {/* Typography Live Preview Sandbox */}
      <div className="typography-preview">
        <span className="typography-preview__label">Live Typography Preview</span>
        <div
          className="typography-preview__box"
          style={{
            fontSize: `${e.fontSize}px`,
            lineHeight: e.lineHeight,
            fontFamily: e.fontFamily || 'var(--or-prose-font)'
          }}
        >
          <h4 style={{ margin: '0 0 0.3em 0', fontSize: '1.25em' }}>The quick brown fox jumps</h4>
          <p style={{ margin: '0 0 0.3em 0' }}>
            Markdown note with <strong>bold</strong>, <em>italic</em> and <code>inline code</code>{' '}
            formatting.
          </p>
        </div>
      </div>

      <h3 className="set-group">Layout</h3>
      <SettingRow
        label="Canvas width"
        description="Readable column presets, edge-to-edge, or an exact width"
      >
        <SegmentedControl
          value={e.lineWidth}
          onChange={(lineWidth) => update({ editor: { ...e, lineWidth } })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
            { value: 'full', label: 'Full' },
            { value: 'custom', label: 'Custom' }
          ]}
        />
      </SettingRow>
      {e.lineWidth === 'custom' && (
        <SettingRow label="Custom width" description="Exact width of the editing column">
          <NumberField
            value={e.customLineWidth}
            min={400}
            max={3000}
            step={20}
            suffix="px"
            onChange={(customLineWidth) => update({ editor: { ...e, customLineWidth } })}
          />
        </SettingRow>
      )}
      <h3 className="set-group">Behavior</h3>
      <SettingRow label="Word wrap" description="Wrap long lines instead of scrolling horizontally">
        <Toggle
          checked={e.wordWrap}
          onChange={(wordWrap) => update({ editor: { ...e, wordWrap } })}
        />
      </SettingRow>
      <SettingRow label="Line numbers">
        <Toggle
          checked={e.lineNumbers}
          onChange={(lineNumbers) => update({ editor: { ...e, lineNumbers } })}
        />
      </SettingRow>
      <SettingRow label="Highlight active line" description="Subtle tint on the line being edited">
        <Toggle
          checked={e.highlightActiveLine}
          onChange={(highlightActiveLine) => update({ editor: { ...e, highlightActiveLine } })}
        />
      </SettingRow>
      <SettingRow
        label="Minimap"
        description="Scaled-down preview of the whole file beside the scrollbar, in code files"
      >
        <Toggle checked={e.minimap} onChange={(minimap) => update({ editor: { ...e, minimap } })} />
      </SettingRow>
      <SettingRow label="Vim mode" description="Vim keybindings, in notes as well as code">
        <Toggle checked={e.vimMode} onChange={(vimMode) => update({ editor: { ...e, vimMode } })} />
      </SettingRow>
      <SettingRow label="Word wrap in code" description="Off keeps columns aligned">
        <Toggle
          checked={e.wordWrapCode}
          onChange={(wordWrapCode) => update({ editor: { ...e, wordWrapCode } })}
        />
      </SettingRow>
      <SettingRow
        label="Indent guides"
        description="Vertical lines marking indentation depth, in code files"
      >
        <Toggle
          checked={e.indentGuides}
          onChange={(indentGuides) => update({ editor: { ...e, indentGuides } })}
        />
      </SettingRow>
      <SettingRow label="Tab size">
        <NumberField
          value={e.tabSize}
          min={1}
          max={8}
          onChange={(tabSize) => update({ editor: { ...e, tabSize } })}
        />
      </SettingRow>
      <h3 className="set-group">Modes</h3>
      <SettingRow
        label="Default view mode"
        description="Edit (source) · Hybrid (live preview) · Reading (view only)"
      >
        <SegmentedControl
          value={e.viewMode}
          onChange={(viewMode) => update({ editor: { ...e, viewMode } })}
          options={[
            { value: 'source', label: 'Edit' },
            { value: 'live', label: 'Hybrid' },
            { value: 'reading', label: 'Reading' }
          ]}
        />
      </SettingRow>
      <SettingRow label="Typewriter" description="Keep the writing line vertically centered">
        <Toggle
          checked={e.typewriter}
          onChange={(typewriter) => update({ editor: { ...e, typewriter } })}
        />
      </SettingRow>
      <SettingRow label="Focus mode" description="Dim everything except the active paragraph">
        <Toggle
          checked={e.focusMode}
          onChange={(focusMode) => update({ editor: { ...e, focusMode } })}
        />
      </SettingRow>
    </>
  )
}
