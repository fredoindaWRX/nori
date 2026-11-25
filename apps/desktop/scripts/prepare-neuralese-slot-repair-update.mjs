// Prepare a bounded bridge refresh against the actual installed app archive.
// This script stages an archive only; it never installs, relaunches, or changes pointers.
import { copyFileSync, existsSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installed = 'C:/Program Files/Nori'
const installedArchive = join(installed, 'resources/app.asar')
const candidate = readFileSync(join(root, 'apps/desktop/release/current-desktop.txt'), 'utf8').trim()
const candidateArchive = join(root, 'apps/desktop/release', `native-desktop-${candidate}/win-unpacked/resources/app.asar`)
const output = join(root, 'verification/neuralese-slot-repair-update-20261021')
const sourceFiles = ['local-chat.mjs', 'neuralese-artcraft-slot-repair.mjs']
const bridgeNames = ['bridge/local-chat.mjs', 'bridge/neuralese-artcraft-plan.mjs', 'bridge/neuralese-artcraft-slot-repair.mjs']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const require = createRequire(import.meta.url)
const { createPackage, extractAll, extractFile, listPackage, statFile } = require('@electron/asar')

for (const path of [root, installed, dirname(installedArchive), dirname(candidateArchive)]) {
  if (realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw new Error(`Linked path refused: ${path}`)
}
if (existsSync(output)) throw new Error(`Existing update staging folder preserved: ${output}`)

mkdirSync(output)
const extracted = join(output, 'archive-source')
const archive = join(output, 'app.asar')
extractAll(installedArchive, extracted)
for (const name of sourceFiles) {
  const source = join(root, 'apps/desktop/bridge', name)
  const target = join(extracted, 'bridge', name)
  copyFileSync(source, target)
  if (hash(readFileSync(source)) !== hash(readFileSync(target))) throw new Error(`Staged source mismatch: ${name}`)
}
const planPath = join(extracted, 'bridge/neuralese-artcraft-plan.mjs')
const planSource = readFileSync(planPath, 'utf8')
const oldAdapterMarker = '    sourceDefinitions: tools.definitions,\n    definitions: [definition],'
if (planSource.split(oldAdapterMarker).length !== 2) {
  throw new Error('Installed Neuralese adapter layout changed; refusing a broad rewrite.')
}
writeFileSync(planPath, planSource.replace(oldAdapterMarker,
  '    sourceDefinitions: tools.definitions,\n    sourceTools: tools,\n    definitions: [definition],'))
await createPackage(extracted, archive)
const bridgeFiles = join(output, 'bridge-files')
mkdirSync(bridgeFiles)
for (const name of bridgeNames) {
  const filename = name.slice('bridge/'.length)
  const source = name === 'bridge/neuralese-artcraft-plan.mjs' ? planPath : join(extracted, name)
  copyFileSync(source, join(bridgeFiles, filename))
}

const names = path => listPackage(path).filter(name => !statFile(path, name.slice(1)).files)
  .map(name => name.slice(1).replaceAll('\\', '/'))
const oldNames = names(installedArchive)
const newNames = names(archive)
const changed = []
for (const name of new Set([...oldNames, ...newNames])) {
  const native = name.split('/').join(sep)
  const before = oldNames.includes(name) ? extractFile(installedArchive, native) : null
  const after = newNames.includes(name) ? extractFile(archive, native) : null
  if (before && after && before.equals(after)) continue
  if (!bridgeNames.includes(name) || !after) throw new Error(`Unexpected archive delta: ${name}`)
  const expected = name === 'bridge/neuralese-artcraft-plan.mjs'
    ? readFileSync(planPath) : readFileSync(join(root, 'apps/desktop', name))
  if (!after.equals(expected)) throw new Error(`Packaged source does not match checkout: ${name}`)
  changed.push(name)
}
if (changed.length !== bridgeNames.length || bridgeNames.some(name => !changed.includes(name))) {
  throw new Error(`Unexpected changed-file set: ${JSON.stringify(changed)}`)
}
const receipt = {
  schema: 'nori.neuralese-slot-repair-update.v1',
  stagedAt: new Date().toISOString(),
  selectedRuntime: candidate,
  installedRoot: installed,
  sourceFiles: bridgeNames,
  installedArchiveBeforeSha256: hash(readFileSync(installedArchive)),
  candidateArchiveBeforeSha256: hash(readFileSync(candidateArchive)),
  stagedArchiveSha256: hash(readFileSync(archive)),
  stagedArchiveBytes: readFileSync(archive).length,
  changedArchiveFiles: changed,
  stagedBridgeFiles: bridgeNames.map(name => ({ relative: `resources/NoriSuite/apps/desktop/${name}`,
    sha256: hash(readFileSync(join(bridgeFiles, name.slice('bridge/'.length)))) })),
  installed: false,
  liveTested: false,
  modelsCopied: 0,
  usbModified: false,
}
writeFileSync(join(output, 'update-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ prepared: true, output, changedArchiveFiles: changed,
  archiveBytes: receipt.stagedArchiveBytes, installed: false, liveTested: false }))
