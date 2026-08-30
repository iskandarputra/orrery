import React from 'react'
import ReactDOM from 'react-dom/client'
// Bundled variable fonts — guaranteed identical typography on every machine.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/newsreader'
import { App } from './App'
import { bootstrap } from './bootstrap'
import { injectThemeCss } from './themes/themes'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/editor.css'

// The palettes go in on the next frame rather than in front of the first
// paint: App cannot stamp `data-theme` until settings have loaded, which is
// several frames later, so nothing is waiting for them.
requestAnimationFrame(injectThemeCss)

bootstrap()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
