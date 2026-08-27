import type { OrreryApi } from '@shared/ipc'

declare global {
  interface Window {
    orrery: OrreryApi
  }
}

export {}
