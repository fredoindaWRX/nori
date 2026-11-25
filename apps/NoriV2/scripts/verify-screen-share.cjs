/**
 * Screen-share grant verifier for the desktop shell.
 *
 * The bug this guards: the Electron main installed a display-media handler
 * that answered with an empty object. `useSystemPicker` is macOS-only in
 * Electron 44, so on Windows that handler was the grant — and the page's
 * getDisplayMedia rejected with `AbortError: Invalid capture constraints`,
 * which the screen blade rendered as "The screen could not be opened".
 *
 * This runs offscreen against the real `desktop/display-media.cjs` the app
 * ships. Default mode must obtain a live stream of the primary display;
 * `--broken` reinstalls the empty-callback handler and must reproduce the
 * exact message, so the guard proves both directions.
 *
 * Usage:
 *   npm run verify:screenshare
 *   npm run verify:screenshare -- --broken
 */
const { app, BrowserWindow, desktopCapturer, screen, session } = require('electron')
const { createServer } = require('node:http')
const { join } = require('node:path')
const { installDisplayMediaHandler } = require(join(__dirname, '..', 'desktop', 'display-media.cjs'))

const BROKEN = process.argv.includes('--broken')

// Broken mode intentionally produces one internal rejection: Electron reports
// "Video was requested, but no video stream was provided" when the handler
// grants nothing. Keep that known noise from burying the real verdict, but
// never mask an unexpected rejection in the fixed run.
process.on('unhandledRejection', (error) => {
  if (BROKEN) return
  console.error('FAILED:', error)
  process.exitCode = 1
})
const PAGE = '<!doctype html><meta charset="utf-8"><title>nori-screen-share-verify</title>'

function servePage() {
  return new Promise((resolveReady) => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(PAGE)
    })
    // 127.0.0.1 is a secure context — the same kind of origin as the app's
    // own face server on 5188, which is where navigator.mediaDevices exists.
    server.listen(0, '127.0.0.1', () => resolveReady(server))
  })
}

/** The renderer call, byte-identical to camera.ts's getDisplayMedia options. */
const CAPTURE = `
  (async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      const track = stream.getVideoTracks()[0]
      const settings = track.getSettings()
      const out = {
        ok: true,
        label: track.label,
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        displaySurface: settings.displaySurface,
      }
      stream.getTracks().forEach((entry) => entry.stop())
      return out
    } catch (error) {
      return { ok: false, name: error?.name ?? null, message: error?.message ?? String(error) }
    }
  })()
`

app.whenReady().then(async () => {
  const server = await servePage()
  const port = server.address().port
  const ses = session.defaultSession
  ses.setPermissionCheckHandler(() => true)
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(true))
  if (BROKEN) {
    // The exact handler the shell shipped before the fix.
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}), { useSystemPicker: true })
  } else {
    installDisplayMediaHandler(ses, { desktopCapturer, screen })
  }

  const win = new BrowserWindow({ show: false, width: 480, height: 320 })
  await win.loadURL(`http://127.0.0.1:${port}/`)
  const result = await win.webContents.executeJavaScript(CAPTURE, true)
  server.close()

  if (BROKEN) {
    const reproduced = result.ok === false && result.message === 'Invalid capture constraints'
    console.log(`BROKEN ${JSON.stringify(result)}`)
    console.log(reproduced
      ? 'Verified: the empty-callback grant reproduces "Invalid capture constraints".'
      : 'UNEXPECTED: the broken handler did not fail as documented.')
    app.exit(reproduced ? 0 : 1)
    return
  }

  const ok = result.ok === true
    && Boolean(result.label)
    && Number(result.width) > 0
    && Number(result.height) > 0
    && result.displaySurface === 'monitor'
    && Number(result.frameRate) > 0
    && Number(result.frameRate) <= 6
  console.log(`FIXED ${JSON.stringify(result)}`)
  console.log(ok
    ? `Verified: screen share grants a live ${result.width}x${result.height}@${result.frameRate}fps ${result.displaySurface} stream.`
    : 'FAILED: the display-media grant did not produce a live stream.')
  app.exit(ok ? 0 : 1)
}).catch((error) => {
  console.error('FAILED:', error)
  app.exit(1)
})
