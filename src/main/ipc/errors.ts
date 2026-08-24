import type { IpcErrorPayload } from '@shared/ipc'

/**
 * Electron serializes rejected invoke() errors down to their message string,
 * so expected failures are encoded as `code|message` and decoded in the
 * renderer by parseIpcError.
 */
export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorPayload['code'],
    message: string
  ) {
    super(`${code}|${message}`)
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof IpcError) return err
  const e = err as NodeJS.ErrnoException
  switch (e?.code) {
    case 'ENOENT':
      return new IpcError('ENOENT', 'File or folder not found')
    case 'EACCES':
    case 'EPERM':
      return new IpcError('EACCES', 'Permission denied')
    case 'EEXIST':
      return new IpcError('EEXIST', 'A file with that name already exists')
    default:
      return new IpcError('UNKNOWN', e?.message ?? 'Unexpected error')
  }
}
