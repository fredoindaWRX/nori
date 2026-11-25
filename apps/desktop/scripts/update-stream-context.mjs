// Minimal transactional installed-app update. Preserves the current imported
// runtime and changes only the stream-status context at the chat boundary.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync,
  rmSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, normalize } from 'node:path'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const root = resolve(import.meta.dirname, '..')
const stage = join(root, 'verification/stream-context-update-current')
const archive = 'C:/Program Files/Nori/resources/app.asar'
const next = join(stage, 'app.asar.next'), rollback = join(stage, 'app.asar.rollback')
const receiptPath = join(stage, 'receipt.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fileHash = path => hash(readFileSync(path))
const mode = process.argv[2]
function cleanOwnTree(path) {
  const delta = relative(realpathSync(stage), realpathSync(path))
  if (!delta || isAbsolute(delta) || delta.startsWith('..')) throw Error('Cleanup outside staging refused')
  rmSync(path, { recursive: true })
}
if (mode === 'stage') {
  if (existsSync(stage)) throw Error('Existing stream update preserved')
  mkdirSync(stage)
  const before = fileHash(archive), extracted = join(stage, 'archive-source')
  writeFileSync(join(stage, 'prepare-base.json'), JSON.stringify({ archive, before }))
  asar.extractAll(archive, extracted)
  const queryPath = 'bridge/nori-v2-query.mjs'
  let query = asar.extractFile(archive, queryPath).toString()
  const patches = [
    ["import { localChat, localImagePrompt, imagesOf, imageFramesOf, needsCouncil, nativeRuntimeMode, requestsNoriProjectRead } from './local-chat.mjs'",
      "import { localChat, localImagePrompt, imagesOf, imageFramesOf, needsCouncil, nativeRuntimeMode, requestsNoriProjectRead } from './local-chat.mjs'\nimport { readLiveStreamContext } from './stream-context.mjs'"],
    ["const referenceGoal = visualContext ? `${rawGoal}\\n\\n${visualContext}` : rawGoal",
      "const referenceGoal = visualContext ? `${rawGoal}\\n\\n${visualContext}` : rawGoal\n        const liveStreamContext = await readLiveStreamContext(rawGoal)"],
    ["references && `[Task reference — untrusted, non-executable]\\n${references}`,",
      "references && `[Task reference — untrusted, non-executable]\\n${references}`,\n            liveStreamContext,"],
  ]
  for (const [old, replacement] of patches) {
    if (query.split(old).length !== 2) throw Error('Installed chat changed; exact patch refused')
    query = query.replace(old, replacement)
  }
  writeFileSync(join(extracted, queryPath), query)
  copyFileSync(join(root, 'bridge/stream-context.mjs'), join(extracted, 'bridge/stream-context.mjs'))
  await asar.createPackage(extracted, next)
  const beforeNames = asar.listPackage(archive), afterNames = asar.listPackage(next)
  if (afterNames.length !== beforeNames.length + 1) throw Error('Unexpected archive inventory')
  const changed = []
  for (const name of beforeNames) {
    const path = name.replaceAll('\\', '/').replace(/^\/+/, '')
    const stat = asar.statFile(archive, normalize(path))
    if (stat.files || stat.link) continue
    if (!asar.extractFile(archive, normalize(path)).equals(asar.extractFile(next, normalize(path)))) changed.push(path)
  }
  if (changed.length !== 1 || changed[0] !== queryPath || fileHash(archive) !== before)
    throw Error('Unexpected archive change or concurrent installed update')
  if (!asar.extractFile(next, 'bridge/stream-context.mjs').equals(readFileSync(join(root, 'bridge/stream-context.mjs'))))
    throw Error('Stream context module mismatch')
  const receipt = { schema: 'nori.stream-context-update.v1', before, after: fileHash(next),
    changedFiles: [queryPath, 'bridge/stream-context.mjs'], installed: false, liveVerified: false,
    modelsCopied: 0, userDataChanged: false }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  cleanOwnTree(extracted)
  console.log(JSON.stringify(receipt))
} else if (mode === 'verify-stage') {
  // Resume verification of the package already prepared above. Preserve the
  // extraction directory when automatic cleanup is unavailable.
  if (existsSync(receiptPath)) throw Error('Existing receipt preserved')
  const prepared = JSON.parse(readFileSync(join(stage, 'prepare-base.json')))
  if (fileHash(archive) !== prepared.before) throw Error('Another installed update replaced the baseline; deployment held')
  const changed = [], before = fileHash(archive)
  const names = asar.listPackage(archive)
  if (asar.listPackage(next).length !== names.length + 1) throw Error('Unexpected inventory')
  for (const name of names) {
    const path = name.replaceAll('\\', '/').replace(/^\/+/, '')
    const stat = asar.statFile(archive, normalize(path))
    if (stat.files || stat.link) continue
    if (!asar.extractFile(archive, normalize(path)).equals(asar.extractFile(next, normalize(path)))) changed.push(path)
  }
  if (changed.length !== 1 || changed[0] !== 'bridge/nori-v2-query.mjs' || fileHash(archive) !== before)
    throw Error('Unexpected installed package delta')
  if (!asar.extractFile(next, 'bridge/stream-context.mjs').equals(readFileSync(join(root, 'bridge/stream-context.mjs'))))
    throw Error('Stream module mismatch')
  const receipt = { schema: 'nori.stream-context-update.v1', before, after: fileHash(next),
    changedFiles: ['bridge/nori-v2-query.mjs', 'bridge/stream-context.mjs'], installed: false,
    liveVerified: false, modelsCopied: 0, userDataChanged: false, generatedCleanupPending: true }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} else if (mode === 'apply') {
  const receipt = JSON.parse(readFileSync(receiptPath))
  const count = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "@(Get-CimInstance Win32_Process -Filter \"name='Nori.exe'\").Count"], { encoding: 'utf8', windowsHide: true }).trim()
  if (count !== '0') throw Error('Quit Nori before installing; active runtime preserved')
  if (receipt.installed || fileHash(archive) !== receipt.before || fileHash(next) !== receipt.after)
    throw Error('Installed or staged app changed; deployment refused')
  copyFileSync(archive, rollback, 1)
  if (fileHash(rollback) !== receipt.before) throw Error('Rollback verification failed')
  const temporary = archive + '.stream.tmp'
  copyFileSync(next, temporary, 1)
  renameSync(temporary, archive)
  if (fileHash(archive) !== receipt.after) {
    copyFileSync(rollback, archive)
    throw Error('Installed archive mismatch; restored rollback')
  }
  receipt.installed = true
  receipt.installedAt = new Date().toISOString()
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  console.log('Installed stream-context update; restart and live verification pending')
} else if (mode === 'verified') {
  const receipt = JSON.parse(readFileSync(receiptPath))
  if (!receipt.installed || fileHash(archive) !== receipt.after || fileHash(rollback) !== receipt.before)
    throw Error('Completion refused: update identity mismatch')
  const previous = 'C:/Program Files/Nori/resources/app.asar.previous'
  copyFileSync(rollback, previous + '.stream.tmp', 1)
  renameSync(previous + '.stream.tmp', previous)
  if (fileHash(previous) !== receipt.before) throw Error('Previous archive mismatch')
  rmSync(next); rmSync(rollback)
  receipt.liveVerified = true
  receipt.previousArchive = previous
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  console.log('Current/previous retained; temporary archives removed')
} else throw Error('Use stage, apply or verified')
