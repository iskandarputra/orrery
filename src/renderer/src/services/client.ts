import type { IpcErrorPayload, OrreryApi } from '@shared/ipc'

/**
 * The renderer's single seam to the outside world. Components and stores use
 * this module instead of touching `window.orrery`, so tests can swap it for an
 * in-memory fake with `setClient`.
 */
let client: OrreryApi =
  typeof window !== 'undefined' && window.orrery ? window.orrery : (null as never)

export function setClient(next: OrreryApi): void {
  client = next
}

export function getClient(): OrreryApi {
  return client
}

export const invoke: OrreryApi['invoke'] = (channel, req) => client.invoke(channel, req)
export const on: OrreryApi['on'] = (channel, listener) => client.on(channel, listener)

/** Decode the `code|message` convention used by main-process IpcError. */
export function parseIpcError(err: unknown): IpcErrorPayload {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron prefixes invoke rejections with "Error invoking remote method '...': Error:".
  const match = raw.match(/(ENOENT|EACCES|CONFLICT|EEXIST|UNKNOWN)\|(.*)$/)
  if (match) {
    return { code: match[1] as IpcErrorPayload['code'], message: match[2] ?? '' }
  }
  return { code: 'UNKNOWN', message: raw }
}
