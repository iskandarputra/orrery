import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import type { IpcEventContract, IpcInvokeContract } from '@shared/ipc'

type Handler<K extends keyof IpcInvokeContract> = (
  event: IpcMainInvokeEvent,
  req: IpcInvokeContract[K]['req']
) => Promise<IpcInvokeContract[K]['res']> | IpcInvokeContract[K]['res']

/**
 * Register a handler for a contract channel. Payloads from the renderer are
 * untrusted input; pass a zod schema to validate at the boundary.
 */
export function handle<K extends keyof IpcInvokeContract>(
  channel: K,
  schema: ZodType<IpcInvokeContract[K]['req']> | null,
  handler: Handler<K>
): void {
  ipcMain.handle(channel, (event, raw: unknown) =>
    handler(event, schema ? schema.parse(raw) : (raw as IpcInvokeContract[K]['req']))
  )
}

/** Push a typed event to a renderer window. */
export function send<K extends keyof IpcEventContract>(
  win: BrowserWindow,
  channel: K,
  payload: IpcEventContract[K]
): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}
