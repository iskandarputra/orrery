import { useStore } from '@/state/store'
import { SettingRow, Toggle } from '../controls'

export function MarkdownSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const m = settings.markdown

  return (
    <>
      <h3 className="set-group">Live preview</h3>
      <SettingRow
        label="Live preview"
        description="Render formatting inline while editing — headings, bold, links and more"
      >
        <Toggle
          checked={m.livePreview}
          onChange={(livePreview) => update({ markdown: { ...m, livePreview } })}
        />
      </SettingRow>
      <SettingRow label="Round bullets" description="Show list markers (-, *, +) as bullets">
        <Toggle
          checked={m.fancyBullets}
          onChange={(fancyBullets) => update({ markdown: { ...m, fancyBullets } })}
        />
      </SettingRow>
      <SettingRow
        label="Interactive checkboxes"
        description="Render task markers as clickable checkboxes"
      >
        <Toggle
          checked={m.interactiveCheckboxes}
          onChange={(interactiveCheckboxes) =>
            update({ markdown: { ...m, interactiveCheckboxes } })
          }
        />
      </SettingRow>
      <SettingRow label="Show images" description="Render ![alt](path) images inline">
        <Toggle
          checked={m.showImages}
          onChange={(showImages) => update({ markdown: { ...m, showImages } })}
        />
      </SettingRow>
      <SettingRow
        label="Reflow paragraphs"
        description="Fill the canvas width like a preview — soft line breaks become spaces"
      >
        <Toggle
          checked={m.reflowParagraphs}
          onChange={(reflowParagraphs) => update({ markdown: { ...m, reflowParagraphs } })}
        />
      </SettingRow>
    </>
  )
}

/** Daily notes and templates — where dated notes land and what seeds them. */
