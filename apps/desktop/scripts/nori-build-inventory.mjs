import {lstatSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const {installedStatePolicy} = createRequire(import.meta.url)('../desktop/installed-state-policy.cjs')

// Never descend through a link when checking nested package locations.
function inspectRelative(root, segments) {
  let path = root
  for (const segment of segments) {
    path = join(path, segment)
    let info
    try { info = lstatSync(path) } catch (error) {
      return {path, status: error.code === 'ENOENT' ? 'missing' : 'unreadable'}
    }
    if (info.isSymbolicLink()) return {path, status: 'linked-not-inspected'}
    if (segment !== segments.at(-1) && !info.isDirectory()) return {path, status: 'not-directory'}
  }
  const info = lstatSync(path)
  return {path, status: info.isDirectory() ? 'directory-present' : 'file-present'}
}

// Inventory only: selection is not proof that another build is disposable.
export function inventoryBuilds(releaseRoot) {
  const root = resolve(releaseRoot)
  if (lstatSync(root).isSymbolicLink()) throw Error('Linked release root refused')
  let selected = null
  let selectionError = null
  try {
    const pointer = join(root, 'current-desktop.txt')
    if (lstatSync(pointer).isSymbolicLink()) throw Error('Linked selection pointer refused')
    selected = readFileSync(pointer, 'utf8').trim()
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(selected)) throw Error('Invalid selection pointer')
  } catch (error) {
    selected = null
    selectionError = error.code === 'ENOENT' ? 'Selection pointer missing' : error.message
  }
  const entries = readdirSync(root).sort().filter(name => name !== 'current-desktop.txt').map(name => {
    const path = join(root, name)
    const info = lstatSync(path)
    const linked = info.isSymbolicLink()
    const role = linked ? 'linked-entry-not-inspected'
      : name === `native-desktop-${selected}` && info.isDirectory() ? 'selected-desktop'
      : name.startsWith('native-desktop') && info.isDirectory() ? 'other-desktop-build'
      : name.startsWith('native-suite') && info.isDirectory() ? 'staging-bundle'
      : name.startsWith('native-installer') && info.isDirectory() ? 'installer-build'
      : 'unclassified'
    let executablePresent = null
    if (role === 'selected-desktop') {
      executablePresent = inspectRelative(path, ['win-unpacked', 'Nori.exe']).status === 'file-present'
    }
    const stateLocations = !linked && info.isDirectory()
      ? [
          ['state'], ['verification'],
          ['NoriSuite', 'state'], ['NoriSuite', 'verification'],
          ['win-unpacked', 'resources', 'NoriSuite', 'state'],
          ['win-unpacked', 'resources', 'NoriSuite', 'verification'],
        ].map(segments => ({relativePath: segments.join('/'), ...inspectRelative(path, segments)}))
      : []
    return {name, path, role, executablePresent, stateLocations, deletionAuthorized: false}
  })
  const current = entries.find(entry => entry.role === 'selected-desktop')
  const executable = current?.executablePresent ? join(current.path, 'win-unpacked', 'Nori.exe') : null
  let packagedStatePolicy = {status: 'not-inspected-no-executable', preparedStateVerified: false}
  if (executable) {
    try {
      const policy = installedStatePolicy({executable, suiteRoot: join(current.path, 'win-unpacked', 'resources', 'NoriSuite')})
      packagedStatePolicy = {status: policy ? 'consolidated-policy-present' : 'no-installed-policy',
        mode: policy?.mode ?? null, preparedStateVerified: false}
    } catch (error) {
      packagedStatePolicy = {status: 'policy-refused', error: error.message, preparedStateVerified: false}
    }
  }
  return {
    releaseRoot: root, selected, selectionError,
    selectedExecutablePresent: current?.executablePresent ?? false,
    selectedExecutable: executable, packagedStatePolicy,
    entries, cleanupQualified: false,
    warning: 'State-location checks inspect names and metadata only, not private contents. Missing known locations does not prove absence of unique work. No deletion, migration, or launch performed.',
  }
}

export function summarizeBuilds(result) {
  const count = role => result.entries.filter(entry => entry.role === role).length
  return [
    'NORI APP SELECTION',
    `Selected build: ${result.selected ?? 'NONE'}`,
    `App executable: ${result.selectedExecutable ?? 'MISSING — do not guess another build'}`,
    `Other desktop builds: ${count('other-desktop-build')}`,
    `Staging bundles: ${count('staging-bundle')}`,
    `Installer builds: ${count('installer-build')}`,
    `Selection problem: ${result.selectionError ?? 'none'}`,
    `Packaged state policy: ${result.packagedStatePolicy.status}`,
    'Policy inspection does not verify permissions, migrate memory, or include launcher/environment overrides.',
    'Old builds are retained copies, not separate assistant identities.',
    'No folders are approved for deletion. Selection is not full release verification.',
  ].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inventoryBuilds(resolve(fileURLToPath(new URL('../release/', import.meta.url))))
  process.stdout.write(`${process.argv.includes('--summary') ? summarizeBuilds(result) : JSON.stringify(result, null, 2)}\n`)
  if (result.selectionError || !result.selectedExecutablePresent) process.exitCode = 1
}
