/// <reference types="vite/client" />

declare module '*.css'

// Bundled font packages are imported for their side effect (injecting @font-face).
declare module '@fontsource-variable/*'

// Vite's `?url` suffix: the file is emitted as an asset and the import is its
// URL, which is how pdf.js is told where its worker lives.
declare module '*?url' {
  const url: string
  export default url
}
