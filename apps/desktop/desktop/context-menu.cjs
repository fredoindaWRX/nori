// Standard text actions only. Do not expose navigation, execution, or devtools.
function contextMenuTemplate(params = {}) {
  if (params.isEditable) return [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
    { type: 'separator' }, { role: 'selectAll' },
  ]
  if (String(params.selectionText || '').trim()) return [{ role: 'copy' }, { role: 'selectAll' }]
  return [{ role: 'selectAll' }]
}

function installContextMenu(window, Menu) {
  const contents = window.webContents
  const handler = (_event, params) => {
    if (window.isDestroyed() || contents.isDestroyed()) return
    Menu.buildFromTemplate(contextMenuTemplate(params)).popup({ window })
  }
  contents.on('context-menu', handler)
  return () => contents.removeListener('context-menu', handler)
}

module.exports = { contextMenuTemplate, installContextMenu }
