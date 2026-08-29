/**
 * Refuse to open real windows on someone's desktop.
 *
 * The suite drives a real Electron app, so running it outside a virtual display
 * throws windows onto whatever screen you are working on, steals focus, and
 * does it once per spec file. Wrapping the runner in xvfb fixes that, and then
 * one `npx playwright test` typed out of habit undoes it again.
 *
 * So the wrappers mark themselves, and running without one stops here with the
 * command that would have worked.
 */
export default function globalSetup(): void {
  const wrapped = process.env['ORRERY_E2E_WRAPPED'] === '1'
  const headed = process.env['ORRERY_HEADED'] === '1'
  const hasDisplay = Boolean(process.env['DISPLAY'] || process.env['WAYLAND_DISPLAY'])

  if (wrapped || headed || !hasDisplay) return

  throw new Error(
    [
      '',
      'Refusing to open Electron windows on your display.',
      '',
      '  ./orrery.sh e2e            all of it',
      '  npm run e2e:run -- <spec>  one file',
      '  ORRERY_HEADED=1 ...        when watching them is the point',
      ''
    ].join('\n')
  )
}
