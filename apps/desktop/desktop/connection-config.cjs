// Public renderer configuration only. Never include runtime/Core credentials.
function rendererConnection(port, workspaceProbe = false, handPort = 9393) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid desktop bridge port')
  if (!Number.isSafeInteger(handPort) || handPort < 1 || handPort > 65535) throw new Error('Invalid hand input port')
  return Object.freeze({ bridgeUrl: `ws://127.0.0.1:${port}`, handInputUrl: `http://127.0.0.1:${handPort}/input`, workspaceProbe: workspaceProbe === true })
}
module.exports = { rendererConnection }
