// First display is one operation regardless of which Electron event arrives.
// Acceptance probes use the same bounds/icon initialization but stay hidden;
// the explicit source demo is shown separately, only after backend readiness.
function bindWindowStartup(window, { probe, currentIcon, arrangeWorkspace, showNori }) {
  let initialized = false
  const initialize = () => {
    if (initialized || window.isDestroyed()) return
    initialized = true
    window.setIcon(currentIcon())
    arrangeWorkspace()
    if (!probe) showNori()
  }
  window.once('ready-to-show', initialize)
  window.webContents.once('did-finish-load', initialize)
}
module.exports = { bindWindowStartup }
