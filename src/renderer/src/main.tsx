import React from 'react'
import ReactDOM from 'react-dom/client'
// Bundled variable fonts — guaranteed identical typography on every machine.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/newsreader'
import { App } from './App'
import { bootstrap } from './bootstrap'
import { generateThemeCss } from './themes/themes'
import './styles/tokens.css'
import './styles/global.css'
import './styles/editor.css'

// Inject all theme palettes before first paint; App picks the active one
// by stamping data-theme on <html>.
const themeStyles = document.createElement('style')
themeStyles.id = 'orrery-themes'
themeStyles.textContent = generateThemeCss()
document.head.appendChild(themeStyles)

bootstrap()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
