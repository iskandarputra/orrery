import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const ASSET_SCHEME = 'orrery-asset'

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

/**
 * After ready: serve `orrery-asset://local/<abs-path>` from disk read-only.
 *
 * With one exception. A document being edited has changes that are deliberately
 * not on disk yet, and the reader showing it must show those — otherwise every
 * edit would have to be written out to be seen, which is the behaviour the
 * draft exists to end. So a path with a draft is served from the draft, and the
 * reader goes on asking for the same URL it always did.
 */
export function handleAssetProtocol(draftFor: (filePath: string) => Uint8Array | undefined): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)
      // Windows drive paths arrive as "/C:/…" — strip the leading slash.
      if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1)
      const draft = draftFor(filePath)
      if (draft) {
        // Copied into a buffer of its own: the response takes ownership of what
        // it is given, and the draft has to survive being read more than once.
        return new Response(new Uint8Array(draft), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(draft.byteLength)
          }
        })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
