/**
 * Which icon a file gets.
 *
 * Two answers, and a file usually has both. A `brand` is the language's own
 * mark — Python's snakes, the Docker whale — vendored from the Material Icon
 * Theme under `renderer/src/assets/file-icons`. A `shape` and `colour` are the
 * house glyph underneath: one of nine stroke drawings in the app's own 16px
 * set, in the colour the language is conventionally drawn in.
 *
 * The house set came first and, on its own, was not enough. Nine glyphs across
 * forty languages meant Python, C, C++, Rust and TypeScript were all `braces`,
 * separated only by shade — which in a tree of forty siblings is a list of
 * identical files. The marks tell them apart at a glance, which is the whole
 * job of an icon in a file tree.
 *
 * The shape is still what is drawn wherever a single-colour glyph is wanted,
 * and it is what a file with no mark of its own falls back to.
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

/** The house glyph and colour, before any mark is laid over it. */
type HouseIcon = Omit<FileIcon, 'brand'>

export interface FileIcon {
  shape: FileIconShape
  /** A conventional colour for the language, or null to use the default. */
  colour: string | null
  /** The language's own mark, when it has one. */
  brand: BrandIconName | null
}

/**
 * Extension to icon.
 *
 * Colours follow the conventions people already associate with each language
 * (TypeScript blue, Rust rust, Go cyan), so the tree is readable to anyone who
 * has seen a repository before.
 */
const BY_EXTENSION: Record<string, HouseIcon> = {
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
  bmp: { shape: 'image', colour: '#a074c4' },
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
const BY_NAME: Record<string, HouseIcon> = {
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

const DEFAULT_ICON: HouseIcon = { shape: 'file', colour: null }

/**
 * The vendored marks, by the name of the file they are kept in.
 *
 * Listed rather than inferred so that a name that does not exist is a type
 * error, and `file-icons.test.ts` checks every one of these against what is
 * actually on disk — a mark that has been renamed upstream is then a failing
 * test rather than a blank space in somebody's tree.
 */
/**
 * Every vendored mark, by the name of the file it is kept in.
 *
 * The list and the type are the same thing, so a name that does not exist is a
 * type error — and `FileIcon.test.tsx` walks this list against the icons that
 * are actually on disk, so a mark renamed upstream is a failing test rather
 * than a blank space in somebody's tree. `scripts/sync-file-icons.mjs` fetches
 * exactly these.
 */
export const BRAND_ICONS = [
  'python',
  'typescript',
  'javascript',
  'react',
  'react_ts',
  'c',
  'cpp',
  'csharp',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'lua',
  'r',
  'dart',
  'elixir',
  'haskell',
  'scala',
  'zig',
  'vim',
  'console',
  'powershell',
  'makefile',
  'docker',
  'exe',
  'html',
  'css',
  'sass',
  'less',
  'vue',
  'svelte',
  'svg',
  'xml',
  'nodejs',
  'json',
  'yaml',
  'toml',
  'database',
  'table',
  'settings',
  'lock',
  'key',
  'tsconfig',
  'npm',
  'git',
  'prettier',
  'eslint',
  'markdown',
  'document',
  'readme',
  'license',
  'todo',
  'log',
  'pdf',
  'image',
  'video',
  'audio',
  'font',
  'zip',
  'excalidraw',
  'folder-base',
  'folder-src',
  'folder-node',
  'folder-git',
  'folder-docs',
  'folder-test',
  'folder-dist',
  'folder-images',
  'folder-config',
  'folder-scripts',
  'folder-public',
  'folder-github',
  'folder-vscode'
] as const

export type BrandIconName = (typeof BRAND_ICONS)[number]

/** The mark for an extension. Kept apart from the house table so each reads. */
const BRAND_BY_EXTENSION: Record<string, BrandIconName> = {
  // Languages
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'react_ts',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'react',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  scala: 'scala',
  sc: 'scala',
  zig: 'zig',
  vim: 'vim',
  // Things you run
  sh: 'console',
  bash: 'console',
  zsh: 'console',
  fish: 'console',
  ps1: 'powershell',
  exe: 'exe',
  appimage: 'exe',
  // Markup and styles
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  svg: 'svg',
  xml: 'xml',
  // Data and configuration
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'database',
  db: 'database',
  sqlite: 'database',
  sqlite3: 'database',
  csv: 'table',
  tsv: 'table',
  ini: 'settings',
  conf: 'settings',
  cfg: 'settings',
  env: 'settings',
  lock: 'lock',
  pem: 'key',
  key: 'key',
  // Documents
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  txt: 'document',
  rst: 'document',
  log: 'log',
  pdf: 'pdf',
  // Opaque things
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  bmp: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  zip: 'zip',
  gz: 'zip',
  tar: 'zip',
  rar: 'zip',
  '7z': 'zip',
  xz: 'zip',
  // Orrery's own
  excalidraw: 'excalidraw'
}

/** And for the whole names that say more than their extension does. */
const BRAND_BY_NAME: Record<string, BrandIconName> = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  makefile: 'makefile',
  'cmakelists.txt': 'makefile',
  'package.json': 'npm',
  'package-lock.json': 'npm',
  '.npmrc': 'npm',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'tsconfig.json': 'tsconfig',
  'go.mod': 'go',
  'go.sum': 'go',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  license: 'license',
  'license.txt': 'license',
  'license.md': 'license',
  'readme.md': 'readme',
  'todo.md': 'todo',
  '.prettierrc': 'prettier',
  '.prettierignore': 'prettier',
  '.editorconfig': 'settings'
}

/**
 * Folders that are worth telling apart.
 *
 * A tree where every folder is the same picture makes you read all of them to
 * find `src`. Anything not named here keeps the plain folder, because a mark
 * on every row is the same as a mark on none.
 */
const BRAND_BY_FOLDER: Record<string, BrandIconName> = {
  src: 'folder-src',
  lib: 'folder-src',
  source: 'folder-src',
  node_modules: 'folder-node',
  '.git': 'folder-git',
  docs: 'folder-docs',
  doc: 'folder-docs',
  documentation: 'folder-docs',
  test: 'folder-test',
  tests: 'folder-test',
  __tests__: 'folder-test',
  spec: 'folder-test',
  e2e: 'folder-test',
  dist: 'folder-dist',
  build: 'folder-dist',
  out: 'folder-dist',
  target: 'folder-dist',
  images: 'folder-images',
  img: 'folder-images',
  assets: 'folder-images',
  media: 'folder-images',
  config: 'folder-config',
  configs: 'folder-config',
  scripts: 'folder-scripts',
  bin: 'folder-scripts',
  public: 'folder-public',
  static: 'folder-public',
  '.github': 'folder-github',
  '.vscode': 'folder-vscode'
}

/** The extension, or an empty string when the name has none. */
function extensionOf(lowerName: string): string {
  // A leading dot is not a separator: `.gitignore` has no extension.
  const dot = lowerName.lastIndexOf('.')
  return dot <= 0 ? '' : lowerName.slice(dot + 1)
}

export function fileIcon(fileName: string): FileIcon {
  const lower = fileName.toLowerCase()
  const extension = extensionOf(lower)
  const brand = BRAND_BY_NAME[lower] ?? BRAND_BY_EXTENSION[extension] ?? null
  const house = BY_NAME[lower] ?? BY_EXTENSION[extension] ?? DEFAULT_ICON
  return { ...house, brand }
}

/** Which mark a folder gets. Every folder has one, most of them the plain one. */
export function folderIcon(folderName: string): BrandIconName {
  return BRAND_BY_FOLDER[folderName.toLowerCase()] ?? 'folder-base'
}
