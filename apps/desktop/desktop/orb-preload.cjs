const { contextBridge, ipcRenderer } = require('electron')
// The floating orb page gets window controls only: no bridge, files, or system access.
contextBridge.exposeInMainWorld('noriFloat', {
  moveBy: (dx, dy) => ipcRenderer.send('nori:orb:move', dx, dy),
  ignore: value => ipcRenderer.send('nori:orb:ignore', Boolean(value)),
  focus: () => ipcRenderer.send('nori:orb:focus'),
  blurred: () => ipcRenderer.send('nori:orb:blur'),
  publish: state => ipcRenderer.send('nori:orb:state', state),
  openFull: () => ipcRenderer.send('nori:orb:open-full'),
})
