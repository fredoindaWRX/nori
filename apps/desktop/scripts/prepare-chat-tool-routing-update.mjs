// Stage a minimal local bridge refresh in the existing Nori installation.
// This builds no new desktop candidate and does not install or change pointers.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installed = 'C:/Program Files/Nori'
const archive = join(installed, 'resources/app.asar')
const previousStage = join(root, 'verification/neuralese-slot-repair-update-20261021')
const previousReceipt = JSON.parse(readFileSync(join(previousStage, 'update-receipt.json'), 'utf8'))
const output = join(root, 'verification/chat-tool-routing-repair-20261021')
const bridgeFiles = ['aider-tools.mjs', 'local-chat.mjs', 'nori-v2-query.mjs']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const require = createRequire(import.meta.url)
const { createPackage, extractAll, extractFile, listPackage, statFile } = require('@electron/asar')

const installedSha = hash(readFileSync(archive))
const previousInstalledSha = previousReceipt.installedFiles?.find(file => file.target === archive)?.sha256
if (previousReceipt.installed !== true || installedSha !== previousInstalledSha) {
  throw new Error('Installed Nori no longer matches the last verified update; staging stopped.')
}
const releasePointer = readFileSync(join(root, 'apps/desktop/release/current-desktop.txt'), 'utf8').trim()
if (releasePointer !== previousReceipt.selectedRuntime) throw new Error('Selected desktop changed; staging stopped.')
if (existsSync(output)) throw new Error(`Existing update folder preserved: ${output}`)
for (const path of [root, installed, dirname(archive)]) {
  if (realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw new Error(`Linked path refused: ${path}`)
}

mkdirSync(output)
const extracted = join(output, 'archive-source')
const stagedArchive = join(output, 'app.asar.next')
const suiteOverlay = join(output, 'suite-bridge')
mkdirSync(suiteOverlay)
extractAll(archive, extracted)
for (const name of bridgeFiles) {
  const source = join(root, 'apps/desktop/bridge', name)
  const target = join(extracted, 'bridge', name)
  copyFileSync(source, target)
  copyFileSync(source, join(suiteOverlay, name))
  if (hash(readFileSync(source)) !== hash(readFileSync(target))) throw new Error(`Staged source mismatch: ${name}`)
}
await createPackage(extracted, stagedArchive)

const names = path => listPackage(path).filter(name => !statFile(path, name.slice(1)).files)
  .map(name => name.slice(1).replaceAll('\\', '/'))
const beforeNames = names(archive)
const afterNames = names(stagedArchive)
const changed = []
for (const name of new Set([...beforeNames, ...afterNames])) {
  const native = name.split('/').join(sep)
  const before = beforeNames.includes(name) ? extractFile(archive, native) : null
  const after = afterNames.includes(name) ? extractFile(stagedArchive, native) : null
  if (before && after && before.equals(after)) continue
  const expected = bridgeFiles.includes(name.split('/').at(-1)) && name.startsWith('bridge/')
    ? readFileSync(join(root, 'apps/desktop', name)) : null
  if (!expected || !after?.equals(expected)) throw new Error(`Unexpected archive delta: ${name}`)
  changed.push(name)
}
const expectedFiles = bridgeFiles.map(name => `bridge/${name}`).sort()
if (JSON.stringify(changed.sort()) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected changed-file set: ${JSON.stringify(changed)}`)
}
const stagedHash = hash(readFileSync(stagedArchive))
const receipt = {
  schema: 'nori.chat-tool-routing-update.v1',
  stagedAt: new Date().toISOString(),
  selectedRuntime: releasePointer,
  installedRoot: installed,
  installedArchiveBeforeSha256: installedSha,
  stagedArchiveSha256: stagedHash,
  stagedArchiveBytes: readFileSync(stagedArchive).length,
  changedArchiveFiles: changed.sort(),
  suiteOverlay: bridgeFiles.map(name => ({ path: `resources/NoriSuite/apps/desktop/bridge/${name}`,
    sha256: hash(readFileSync(join(suiteOverlay, name))) })),
  installed: false,
  liveTested: false,
  usbModified: false,
}
writeFileSync(join(output, 'update-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
const extractReal = realpathSync(extracted)
if (!extractReal.toLowerCase().startsWith(`${realpathSync(output).toLowerCase()}${sep}`)) {
  throw new Error('Temporary extraction escaped the task staging folder; preserve for inspection.')
}
rmSync(extracted, { recursive: true })
console.log(JSON.stringify({ prepared: true, output, changedArchiveFiles: changed.sort(),
  archiveBytes: receipt.stagedArchiveBytes, installed: false, runtimeCandidateCreated: false }))
