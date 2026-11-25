// Apply the prepared bridge fix to the installed app only, with byte-verified rollback.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installed = 'C:/Program Files/Nori'
const stage = join(root, 'verification/neuralese-slot-repair-update-20261021')
const receiptPath = join(stage, 'update-receipt.json')
const rollback = join(stage, 'rollback')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
const archiveTarget = join(installed, 'resources/app.asar')
const files = [
  { source: join(stage, 'app.asar'), target: archiveTarget, sha256: receipt.stagedArchiveSha256 },
  ...receipt.stagedBridgeFiles.map(file => ({ source: join(stage, 'bridge-files', file.relative.split('/').at(-1)),
    target: join(installed, ...file.relative.split('/')), sha256: file.sha256 })),
]

if (receipt.schema !== 'nori.neuralese-slot-repair-update.v1' || receipt.installed !== false
  || receipt.liveTested !== false || receipt.usbModified !== false) throw new Error('Update receipt state is not eligible.')
for (const path of [root, stage, installed, dirname(archiveTarget)]) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) {
    throw new Error(`Linked or missing update path refused: ${path}`)
  }
}
const ps = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
const liveCount = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process -Filter \"name='Nori.exe'\").Count"],
  { encoding: 'utf8', windowsHide: true }).trim()
if (liveCount !== '0') throw new Error('Nori processes are running; installed update refused.')
if (hash(readFileSync(archiveTarget)) !== receipt.installedArchiveBeforeSha256) {
  throw new Error('Installed app archive changed after staging; update refused.')
}
for (const file of files) {
  for (const path of [dirname(file.source), dirname(file.target)]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) {
      throw new Error(`Linked or missing file parent refused: ${path}`)
    }
  }
  if (!existsSync(file.source) || hash(readFileSync(file.source)) !== file.sha256) throw new Error(`Staged file hash mismatch: ${file.source}`)
  if (existsSync(file.target) && lstatSync(file.target).isSymbolicLink()) throw new Error(`Target linked: ${file.target}`)
}
const rollbackManifest = join(rollback, 'before.json')
let originalHashes
if (existsSync(rollback)) {
  if (lstatSync(rollback).isSymbolicLink() || realpathSync(rollback).toLowerCase() !== resolve(rollback).toLowerCase()
    || !existsSync(rollbackManifest) || existsSync(join(rollback, 'applied.json'))) {
    throw new Error('Existing rollback folder cannot be reused.')
  }
  const saved = JSON.parse(readFileSync(rollbackManifest, 'utf8'))
  if (!Array.isArray(saved.files) || saved.files.length !== files.length) throw new Error('Rollback manifest shape changed.')
  originalHashes = saved.files
  for (let index = 0; index < files.length; index++) {
    const prior = originalHashes[index]
    const expectedBackup = join(rollback, `${index}-${files[index].target.split(/[\\/]/).at(-1)}`)
    if (prior.target !== files[index].target || typeof prior.existed !== 'boolean'
      || existsSync(files[index].target) !== prior.existed) throw new Error('Installed file changed since rollback capture.')
    if (prior.existed) {
      if (prior.backup !== expectedBackup || !existsSync(expectedBackup)
        || lstatSync(expectedBackup).isSymbolicLink() || typeof prior.sha256 !== 'string'
        || hash(readFileSync(expectedBackup)) !== prior.sha256
        || hash(readFileSync(prior.target)) !== prior.sha256) throw new Error('Rollback copy no longer matches the installed file.')
    } else if (prior.backup !== null || prior.sha256 !== null) {
      throw new Error('Rollback manifest describes an unexpected new file.')
    }
  }
} else {
  if (process.argv.includes('--preflight')) throw new Error('Preflight requires an existing verified rollback copy.')
  mkdirSync(rollback)
  originalHashes = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    const backup = join(rollback, `${index}-${file.target.split(/[\\/]/).at(-1)}`)
    if (existsSync(file.target)) {
      copyFileSync(file.target, backup, 1)
      const beforeSha256 = hash(readFileSync(file.target))
      if (hash(readFileSync(backup)) !== beforeSha256) throw new Error('Rollback copy did not verify.')
      originalHashes.push({ target: file.target, backup, sha256: beforeSha256, existed: true })
    } else originalHashes.push({ target: file.target, backup: null, sha256: null, existed: false })
  }
  writeFileSync(rollbackManifest, JSON.stringify({ files: originalHashes }, null, 2) + '\n', { flag: 'wx' })
}
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ ready: true, stagedFiles: files.length, rollbackVerified: true,
    noriStopped: true, installedArchiveUnchanged: true, requiresElevation: true }))
  process.exit(0)
}
const touched = []
try {
  for (const file of files) {
    const temporary = file.target + '.slot-repair.tmp'
    if (existsSync(temporary)) throw new Error(`Existing temporary update file preserved: ${temporary}`)
    copyFileSync(file.source, temporary, 1)
    if (hash(readFileSync(temporary)) !== file.sha256) throw new Error(`Update copy mismatch: ${file.target}`)
    renameSync(temporary, file.target)
    touched.push(file)
  }
  for (const file of files) if (hash(readFileSync(file.target)) !== file.sha256) throw new Error(`Installed file mismatch: ${file.target}`)
  receipt.installed = true
  receipt.installedAt = new Date().toISOString()
  receipt.installAttempt = { result: 'applied', priorBlockedReason: receipt.installAttempt?.reason ?? null,
    rollbackCopiesPreserved: true }
  receipt.installedFiles = files.map(file => ({ target: file.target, sha256: file.sha256 }))
  writeFileSync(receiptPath + '.applied.tmp', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  renameSync(receiptPath + '.applied.tmp', receiptPath)
  writeFileSync(join(rollback, 'applied.json'), JSON.stringify({ filesVerified: files.length, liveTested: false }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ applied: true, files: files.length, rollback, liveTested: false,
    selectedReleaseUnchanged: true, usbModified: false }))
} catch (error) {
  for (const [index, file] of touched.entries()) {
    const prior = originalHashes[index]
    if (prior.existed) {
      const temporary = file.target + '.restore.tmp'
      copyFileSync(prior.backup, temporary, 1)
      renameSync(temporary, file.target)
    } else if (existsSync(file.target)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(file.target)
    }
  }
  throw error
}
