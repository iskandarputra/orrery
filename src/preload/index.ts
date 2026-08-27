import { contextBridge, ipcRenderer } from 'electron'
import type { OrreryApi } from '@shared/ipc'

/**
 * The only bridge between renderer and main. Kept intentionally dumb:
 * all typing lives in the shared contract, all behavior in main handlers.
 */
const api: OrreryApi = {
  invoke: (channel, req) => ipcRenderer.invoke(channel, req),
  on: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('orrery', api)
