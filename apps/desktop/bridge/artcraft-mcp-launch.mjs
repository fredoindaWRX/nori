/** Per-CLI MCP launch contracts for the packaged StoryTold apps. */
const TWO_ROOT_APPS = new Set(['photocraft', 'vectorcraft', 'effectcraft', 'wordcraft', 'soundcraft'])
const ARTCRAFT_APPS = new Set([
  'photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft', 'effectcraft',
  'designcraft', 'figcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'cadcraft', 'gridcraft',
])

export function artcraftMcpLaunchConfig(appId, appWorkspace, outputRoot) {
  if (!ARTCRAFT_APPS.has(appId)) throw new Error(`Unknown ArtCraft MCP app: ${String(appId)}`)
  if (typeof appWorkspace !== 'string' || !appWorkspace || typeof outputRoot !== 'string' || !outputRoot) {
    throw new TypeError('ArtCraft MCP workspace paths are required.')
  }
  if (TWO_ROOT_APPS.has(appId)) return Object.freeze({
    args: Object.freeze(['mcp', '--automation-read-root', appWorkspace, '--automation-write-root', outputRoot]),
    serverScope: 'two-root-scoped',
  })
  if (appId === 'pdfcraft') return Object.freeze({
    args: Object.freeze(['mcp', '--root', appWorkspace, '--compact']),
    serverScope: 'single-root-scoped',
  })
  return Object.freeze({ args: Object.freeze(['mcp']), serverScope: 'nori-path-scoped' })
}
