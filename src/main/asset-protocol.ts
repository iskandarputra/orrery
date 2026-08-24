import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const ASSET_SCHEME = 'zymd-asset'

/**
 * Must run before app `ready`. Marks the asset scheme as standard + secure so
 * the renderer can load local images without disabling webSecurity.
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      // corsEnabled: images/fetch from the app origin are cross-origin to this
      // scheme (http://localhost in dev, file:// packaged) and blocked without it.
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/** After ready: serve `zymd-asset://local/<abs-path>` from disk read-only. */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)
      // Windows drive paths arrive as "/C:/…" — strip the leading slash.
      if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
