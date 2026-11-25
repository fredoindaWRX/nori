// Explicit source selection is required on Windows; never silently pick a monitor.
function chooseDisplaySource(sources, { Menu, getWindow }) {
  const window = getWindow()
  if (!window || window.isDestroyed()) return Promise.resolve(null)
  return new Promise(resolve => {
    const items = type => sources.filter(source => source.id.startsWith(type + ':')).map(source => ({
      label: String(source.name || source.id).replaceAll('&', '&&'),
      click: () => resolve(source),
    }))
    const windows = items('window'), screens = items('screen')
    const menu = Menu.buildFromTemplate([
      { label: 'Share a window with Nori', enabled: windows.length > 0, submenu: windows },
      { label: 'Share an entire screen with Nori', enabled: screens.length > 0, submenu: screens },
      { type: 'separator' }, { label: 'Cancel', click: () => resolve(null) },
    ])
    // The close callback fires before a chosen item's click on Windows; settle as
    // cancelled only if no item was chosen shortly after the menu closed.
    menu.popup({ window, callback: () => setTimeout(() => resolve(null), 250) })
  })
}

function installDisplayMediaHandler(ses, { desktopCapturer, Menu, getWindow }) {
  let pending = false
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (pending) return callback({})
    pending = true
    let source = null
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } })
      source = await chooseDisplaySource(sources, { Menu, getWindow })
      if (!sources.includes(source)) source = null
    } catch { source = null }
    finally { pending = false }
    if (!source) return callback({})
    callback(request?.audioRequested ? { video: source, audio: 'loopback' } : { video: source })
  }, { useSystemPicker: false })
}

module.exports = { installDisplayMediaHandler, chooseDisplaySource }
