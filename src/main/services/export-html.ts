import { marked } from 'marked'

/** Print-friendly GitHub-like stylesheet embedded into exports. */
const EXPORT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 16px; line-height: 1.7; color: #24292f; background: #fff;
    max-width: 46rem; margin: 0 auto; padding: 3rem 2rem;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.5em; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
  h1, h2 { border-bottom: 1px solid #d9dce0; padding-bottom: 0.3em; }
  a { color: #4f6ef2; }
  code {
    font-family: 'MesloLGL Nerd Font Mono', 'JetBrains Mono', 'Consolas', monospace; font-size: 0.9em;
    background: rgba(99, 110, 123, 0.14); border-radius: 4px; padding: 0.1em 0.3em;
  }
  pre { background: #f3f4f6; border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; font-size: 0.875em; }
  blockquote {
    margin: 0; padding-left: 1em; border-left: 3px solid #d9dce0; color: #59636e;
  }
  table { border-collapse: collapse; font-size: 0.95em; }
  th, td { border: 1px solid #d9dce0; padding: 6px 13px; text-align: left; }
  th { background: #f3f3f5; }
  tbody tr:nth-child(2n) { background: #fafafa; }
  hr { border: none; height: 2px; background: #d9dce0; border-radius: 1px; margin: 2em 0; }
  img { max-width: 100%; }
  mark { background: rgba(255, 213, 20, 0.45); border-radius: 3px; padding: 0.05em 0.15em; }
  .wikilink { color: #4f6ef2; }
  input[type='checkbox'] { margin-right: 0.4em; }
  @media print { body { padding: 0; } }
`

/** orrery-specific syntax marked doesn't know: [[wikilinks]] and ==highlights==. */
function preprocess(markdown: string): string {
  return markdown
    .replace(
      /\[\[([^\][#|\n]+)(#[^\][|\n]*)?(?:\|([^\][\n]*))?\]\]/g,
      (_m, target: string, _h, alias?: string) =>
        `<span class="wikilink">${(alias ?? target).trim()}</span>`
    )
    .replace(/==([^=\n][^=\n]*?)==/g, '<mark>$1</mark>')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Standalone HTML document for a note (pure — no Electron, testable). */
export async function buildExportHtml(title: string, markdown: string): Promise<string> {
  const body = await marked.parse(preprocess(markdown), { gfm: true, breaks: false })
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${EXPORT_CSS}</style>`,
    '</head>',
    `<body>\n${body}\n</body>`,
    '</html>'
  ].join('\n')
}
