/**
 * Display-media grants for the Nori window.
 *
 * `getDisplayMedia` in Electron has no browser picker behind it: the main
 * process either names a source or the page's request fails. `useSystemPicker`
 * does not cover that gap — Electron 44's own types call it macOS 15+ and
 * experimental — so on Windows this handler IS the grant, and answering the
 * callback with an empty object rejects `getDisplayMedia` with
 * "Invalid capture constraints", which is the exact error the screen blade
 * used to show.
 *
 * The grant is the primary display, matched by display id so the capture
 * follows the screen the window is actually spanning rather than whichever
 * entry Chromium happened to list first.
 */

function installDisplayMediaHandler(ses, { desktopCapturer, screen }) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    let source = null
    try {
      const primary = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      source = sources.find((candidate) => String(candidate.display_id) === String(primary.id))
        ?? sources[0]
        ?? null
    } catch { source = null }
    // No source is a genuine failure and the page must see it rather than a
    // frozen black frame. With a source, grant video and — only when the page
    // actually asked — system audio (loopback is Windows-only per the types).
    if (!source) return callback({})
    callback(request?.audioRequested ? { video: source, audio: 'loopback' } : { video: source })
  }, {
    // Honoured where a system picker exists (macOS 15+); everywhere else the
    // handler above is the fallback, which is why it has to name a source.
    useSystemPicker: true,
  })
}

module.exports = { installDisplayMediaHandler }
