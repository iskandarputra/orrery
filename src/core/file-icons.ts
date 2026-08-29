/**
 * Which icon and colour a file gets.
 *
 * Orrery draws its own set rather than vendoring one. Real language logos are
 * trademarks with their own usage terms, and shipping forty of them in an
 * MIT-licensed application would undo the work of making its licensing simple
 * to reason about. Colours are not trademarkable, and a shape family carries
 * enough to tell a stylesheet from a shell script at a glance.
 *
 * So a file is identified by two things: a glyph for the *kind* of thing it is,
 * and the colour the language is conventionally drawn in. At the size a file
 * tree renders, colour does most of the work anyway.
 */

export type FileIconShape =
  | 'file-text' // prose
  | 'braces' // a C-like or curly-brace language
  | 'angle' // markup
  | 'brackets' // structured data
  | 'hash' // configuration
  | 'terminal' // a script you run
  | 'image'
  | 'binary'
  | 'file'

export interface FileIcon {
  shape: FileIconShape
  /** A conventional colour for the language, or null to use the default. */
  colour: string | null
}

/**
 * Extension to icon.
 *
 * Colours follow the conventions people already associate with each language
 * (TypeScript blue, Rust rust, Go cyan), so the tree is readable to anyone who
 * has seen a repository before.
 */
const BY_EXTENSION: Record<string, FileIcon> = {
  // Prose
  md: { shape: 'file-text', colour: null },
  markdown: { shape: 'file-text', colour: null },
  mdown: { shape: 'file-text', colour: null },
  mkd: { shape: 'file-text', colour: null },
  txt: { shape: 'file-text', colour: null },
  rst: { shape: 'file-text', colour: null },

  // Curly-brace languages
  ts: { shape: 'braces', colour: '#3178c6' },
  tsx: { shape: 'braces', colour: '#3178c6' },
  js: { shape: 'braces', colour: '#f1c40f' },
  jsx: { shape: 'braces', colour: '#f1c40f' },
  mjs: { shape: 'braces', colour: '#f1c40f' },
  cjs: { shape: 'braces', colour: '#f1c40f' },
  rs: { shape: 'braces', colour: '#dea584' },
  go: { shape: 'braces', colour: '#00add8' },
  java: { shape: 'braces', colour: '#b07219' },
  kt: { shape: 'braces', colour: '#a97bff' },
  swift: { shape: 'braces', colour: '#f05138' },
  c: { shape: 'braces', colour: '#555555' },
  h: { shape: 'braces', colour: '#555555' },
  cpp: { shape: 'braces', colour: '#f34b7d' },
  hpp: { shape: 'braces', colour: '#f34b7d' },
  cs: { shape: 'braces', colour: '#178600' },
  php: { shape: 'braces', colour: '#4f5d95' },
  scala: { shape: 'braces', colour: '#c22d40' },
  dart: { shape: 'braces', colour: '#00b4ab' },
  zig: { shape: 'braces', colour: '#ec915c' },

  // Indentation-led languages, drawn the same way; the colour separates them
  py: { shape: 'braces', colour: '#3572a5' },
  rb: { shape: 'braces', colour: '#701516' },
  ex: { shape: 'braces', colour: '#6e4a7e' },
  exs: { shape: 'braces', colour: '#6e4a7e' },
  hs: { shape: 'braces', colour: '#5e5086' },
  lua: { shape: 'braces', colour: '#000080' },
  r: { shape: 'braces', colour: '#198ce7' },

  // Markup and styles
  html: { shape: 'angle', colour: '#e34c26' },
  htm: { shape: 'angle', colour: '#e34c26' },
  xml: { shape: 'angle', colour: '#0060ac' },
  svg: { shape: 'angle', colour: '#ffb13b' },
  vue: { shape: 'angle', colour: '#41b883' },
  svelte: { shape: 'angle', colour: '#ff3e00' },
  css: { shape: 'hash', colour: '#563d7c' },
  scss: { shape: 'hash', colour: '#c6538c' },
  less: { shape: 'hash', colour: '#1d365d' },

  // Data
  json: { shape: 'brackets', colour: '#cbcb41' },
  jsonc: { shape: 'brackets', colour: '#cbcb41' },
  yml: { shape: 'brackets', colour: '#cb171e' },
  yaml: { shape: 'brackets', colour: '#cb171e' },
  toml: { shape: 'brackets', colour: '#9c4221' },
  csv: { shape: 'brackets', colour: '#89e051' },
  sql: { shape: 'brackets', colour: '#e38c00' },

  // Configuration
  env: { shape: 'hash', colour: '#8a8a8a' },
  ini: { shape: 'hash', colour: '#8a8a8a' },
  conf: { shape: 'hash', colour: '#8a8a8a' },
  lock: { shape: 'hash', colour: '#8a8a8a' },

  // Things you run
  sh: { shape: 'terminal', colour: '#89e051' },
  bash: { shape: 'terminal', colour: '#89e051' },
  zsh: { shape: 'terminal', colour: '#89e051' },
  fish: { shape: 'terminal', colour: '#89e051' },
  ps1: { shape: 'terminal', colour: '#012456' },

  // Images and other opaque things
  png: { shape: 'image', colour: '#a074c4' },
  jpg: { shape: 'image', colour: '#a074c4' },
  jpeg: { shape: 'image', colour: '#a074c4' },
  gif: { shape: 'image', colour: '#a074c4' },
  webp: { shape: 'image', colour: '#a074c4' },
  avif: { shape: 'image', colour: '#a074c4' },
  ico: { shape: 'image', colour: '#a074c4' },
  pdf: { shape: 'binary', colour: '#e05252' },
  zip: { shape: 'binary', colour: '#afb42b' },
  gz: { shape: 'binary', colour: '#afb42b' },
  tar: { shape: 'binary', colour: '#afb42b' },
  woff: { shape: 'binary', colour: '#c792ea' },
  woff2: { shape: 'binary', colour: '#c792ea' },
  ttf: { shape: 'binary', colour: '#c792ea' },

  // Orrery's own
  canvas: { shape: 'brackets', colour: '#7c93ff' },
  excalidraw: { shape: 'image', colour: '#6965db' }
}

/**
 * Whole names that carry more meaning than their extension.
 *
 * A `Dockerfile` has no extension at all, and `package.json` says more about a
 * project than "some JSON" does.
 */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: { shape: 'terminal', colour: '#2496ed' },
  makefile: { shape: 'terminal', colour: '#6d8086' },
  'package.json': { shape: 'brackets', colour: '#8bc500' },
  'package-lock.json': { shape: 'hash', colour: '#8a8a8a' },
  'cargo.toml': { shape: 'brackets', colour: '#dea584' },
  'cargo.lock': { shape: 'hash', colour: '#8a8a8a' },
  'tsconfig.json': { shape: 'brackets', colour: '#3178c6' },
  '.gitignore': { shape: 'hash', colour: '#f14e32' },
  '.gitattributes': { shape: 'hash', colour: '#f14e32' },
  license: { shape: 'file-text', colour: '#d4af37' },
  'license.txt': { shape: 'file-text', colour: '#d4af37' },
  'license.md': { shape: 'file-text', colour: '#d4af37' },
  'readme.md': { shape: 'file-text', colour: '#0288d1' }
}

const DEFAULT_ICON: FileIcon = { shape: 'file', colour: null }

export function fileIcon(fileName: string): FileIcon {
  const lower = fileName.toLowerCase()
  const named = BY_NAME[lower]
  if (named) return named
  // The last segment, so `.test.ts` is TypeScript and `.tar.gz` is an archive.
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return DEFAULT_ICON
  return BY_EXTENSION[lower.slice(dot + 1)] ?? DEFAULT_ICON
}
