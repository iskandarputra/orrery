import type { ZymdApi } from '@shared/ipc'

declare global {
  interface Window {
    zymd: ZymdApi
  }
}

export {}
