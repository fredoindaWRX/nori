// Atomically apply the staged identity-only app.asar update, with rollback.
// Run elevated on Windows. No model, suite file, or user-data path is written.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installedRoot = 'C:/Program Files/Nori'
const archive = join(installedRoot, 'resources/app.asar')
const stage = join(root, 'apps/desktop/verification/installed-identity-update-20261025-r4')
const receiptPath = join(stage, 'update-receipt.json')
const stagedArchive = join(stage, 'app.asar.next')
const rollback = join(stage, 'app.asar.rollback')
const temporary = join(dirname(archive), 'app.asar.identity.tmp')
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex')

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
if (receipt.schema !== 'nori.installed-identity-update.v1' || receipt.installed !== false ||
    receipt.liveTested !== false || receipt.modelsCopied !== 0 || receipt.userDataChanged !== false) {
  throw new Error('Identity update receipt is not eligible for installation.')
}
for (const path of [root, installedRoot, dirname(archive), stage]) {
  if (lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) {
    throw new Error(`Linked or unexpected update path refused: ${path}`)
  }
}
if (hashFile(archive) !== receipt.installedArchiveSha256) throw new Error('Installed app changed after staging.')
if (hashFile(stagedArchive) !== receipt.stagedArchiveSha256) throw new Error('Staged app archive failed its hash check.')
if (existsSync(rollback) || existsSync(temporary)) throw new Error('Existing rollback or temporary file preserved.')
const processCount = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "@(Get-CimInstance Win32_Process -Filter \"name='Nori.exe'\").Count"], { encoding: 'utf8', windowsHide: true }).trim()
if (processCount !== '0') throw new Error('Nori is running; installed update refused.')

if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ ready: true, changedFiles: receipt.changedFiles,
    installedArchiveUnchanged: true, stagedArchiveHashVerified: true,
    noriStopped: true, modelsCopied: 0, userDataChanged: false, requiresElevation: true }))
  process.exit(0)
}

copyFileSync(archive, rollback, 1)
if (hashFile(rollback) !== receipt.installedArchiveSha256) throw new Error('Rollback archive copy failed verification.')
try {
  copyFileSync(stagedArchive, temporary, 1)
  if (hashFile(temporary) !== receipt.stagedArchiveSha256) throw new Error('Temporary archive copy failed verification.')
  renameSync(temporary, archive)
  if (hashFile(archive) !== receipt.stagedArchiveSha256) throw new Error('Installed app archive failed post-replacement verification.')
} catch (error) {
  if (existsSync(temporary)) renameSync(temporary, `${temporary}.failed`)
  if (existsSync(rollback) && hashFile(rollback) === receipt.installedArchiveSha256) {
    copyFileSync(rollback, temporary, 1)
    renameSync(temporary, archive)
  }
  throw error
}
receipt.installed = true
receipt.installedAt = new Date().toISOString()
receipt.liveTested = false
receipt.rollbackCopy = rollback
receipt.rollbackSha256 = hashFile(rollback)
receipt.installedArchiveAfterSha256 = hashFile(archive)
writeFileSync(`${receiptPath}.applied.tmp`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
renameSync(`${receiptPath}.applied.tmp`, receiptPath)
console.log(JSON.stringify({ installed: true, liveTested: false, changedFiles: receipt.changedFiles,
  rollbackCopy: rollback, rollbackVerified: true, modelsCopied: 0, userDataChanged: false }))
