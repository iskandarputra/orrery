import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')
const core = resolve(__dirname, 'src/core')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared, '@core': core }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared, '@core': core }
    }
  },
  renderer: {
    /**
     * A port of its own, and a strict one.
     *
     * Vite's default 5173 is the port every other project on the machine wants
     * too, so the dev URL used to wander: 5173 taken means 5174, then 5175, and
     * "open localhost:5173" then shows somebody else's app instead of this one.
     *
     * `strictPort` is the more useful half. Without it a second `npm run dev`
     * quietly starts a second dev server whose Electron then hits the single
     * instance lock and exits with status 0, so no window appears and nothing
     * says why. With it, the second run fails immediately and names the reason.
     */
    server: { port: 5273, strictPort: true },
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': shared,
        '@core': core,
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
