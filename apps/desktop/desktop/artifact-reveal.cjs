const fs = require('node:fs')
const path = require('node:path')

const APPS = new Set(['photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft',
  'effectcraft', 'designcraft', 'figcraft', 'wordcraft', 'soundcraft', 'deckcraft',
  'cadcraft', 'gridcraft'])

function revealArtCraftArtifact({ dataRoot, owns, showItemInFolder }) {
  if (typeof owns !== 'function' || typeof showItemInFolder !== 'function') throw new TypeError('Host-only artifact reveal dependencies required')
  return (event, args) => {
    if (!owns(event) || !args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).sort().join(',') !== 'appId,path' || !APPS.has(args.appId)
      || typeof args.path !== 'string' || !path.isAbsolute(args.path)) return false
    try {
      const root = fs.realpathSync(path.join(dataRoot, 'integrations', 'artcraft', 'workspaces',
        'app-sandboxes', args.appId, 'outputs'))
      const file = fs.realpathSync(args.path)
      const relative = path.relative(root, file)
      const info = fs.lstatSync(file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative) || !info.isFile() || info.isSymbolicLink()) return false
      showItemInFolder(file)
      return true
    } catch { return false }
  }
}

module.exports = { revealArtCraftArtifact }
