// Explicit sensor-denied acceptance session. Never enabled by a renderer URL.
const { realpathSync, statSync } = require('node:fs')
const { relative, isAbsolute, basename, resolve, sep, join } = require('node:path')
const { nativeStateLayout } = require('./native-state-layout.cjs')
function workspaceProbe(root, argv, environment) {
  if(argv.includes('--consolidated-layout-probe')&&!argv.includes('--workspace-probe'))
    throw Error('Consolidated layout probe requires explicit workspace-probe mode')
  if (!argv.includes('--workspace-probe')) return null
  const candidate = environment.NORI_WORKSPACE_PROBE_STATE
  if (!candidate || !isAbsolute(candidate)) throw new Error('Workspace probe needs an isolated state directory')
  const directory = realpathSync(candidate), canonicalRoot = realpathSync(root)
  let layoutRoot
  if(argv.includes('--consolidated-layout-probe')){
    const requested=environment.NORI_WORKSPACE_PROBE_LAYOUT_ROOT
    if(typeof requested!=='string'||!isAbsolute(requested))throw Error('Consolidated probe requires its generated layout root')
    const layout=nativeStateLayout(requested),layoutDelta=relative(join(canonicalRoot,'verification'),layout.root)
    if(layoutDelta!==basename(layout.root)||!/^\.native-browser-migration-[\w-]+$/.test(layoutDelta)||directory!==layout.desktop||resolve(candidate)!==directory)
      throw Error('Consolidated probe layout must be an unlinked generated fixture under Nori verification')
    layoutRoot=layout.root
  }
  const delta = relative(canonicalRoot, directory)
  if (!layoutRoot&&(delta.startsWith('..') || isAbsolute(delta) || !delta.startsWith(`verification${sep}.native-desktop-probe-`) ||
    !/^\.native-desktop-probe-[\w-]+$/.test(basename(directory)) || !statSync(directory).isDirectory() || resolve(candidate) !== directory)) {
    throw new Error('Workspace probe state must be an unlinked isolated directory under Nori verification')
  }
  const ownerUrl = environment.NORI_WORKSPACE_PROBE_OWNER_URL, ownerKey = environment.NORI_WORKSPACE_PROBE_OWNER_KEY
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/owner$/.test(ownerUrl || '') ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(ownerKey || '')) throw new Error('Workspace probe requires its private loopback owner heartbeat')
  return { directory, ownerUrl, ownerKey, ...(layoutRoot?{layoutRoot}:{}) }
}
module.exports = { workspaceProbe }
