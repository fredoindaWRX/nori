// Install the staged three-file bridge refresh with one verified rollback set.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const installed = 'C:/Program Files/Nori'
const stage = join(root, 'verification/chat-tool-routing-repair-20261021')
const receiptPath = join(stage, 'update-receipt.json')
const rollback = join(stage, 'rollback')
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const targetArchive = join(installed, 'resources/app.asar')
const files = [
  { source: join(stage, 'app.asar.next'), target: targetArchive, sha256: receipt.stagedArchiveSha256 },
  ...receipt.suiteOverlay.map(file => ({ source: join(stage, 'suite-bridge', file.path.split('/').at(-1)),
    target: join(installed, ...file.path.split('/')), sha256: file.sha256 })),
]
if (receipt.schema !== 'nori.chat-tool-routing-update.v1' || receipt.installed !== false
  || receipt.liveTested !== false || receipt.usbModified !== false || files.length !== 4) {
  throw new Error('Update receipt state is not eligible.')
}
for (const path of [root, stage, installed, dirname(targetArchive)]) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()
    || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw new Error(`Linked or missing path refused: ${path}`)
}
const ps = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
const liveCount = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process -Filter \"name='Nori.exe'\").Count"],
  { encoding: 'utf8', windowsHide: true }).trim()
if (liveCount !== '0') throw new Error('Nori processes are running; installed update refused.')
if (hash(readFileSync(targetArchive)) !== receipt.installedArchiveBeforeSha256) {
  throw new Error('Installed app archive changed after staging; update refused.')
}
for (const file of files) {
  for (const path of [dirname(file.source), dirname(file.target)]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()
      || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw new Error(`Linked or missing parent refused: ${path}`)
  }
  if (!existsSync(file.source) || hash(readFileSync(file.source)) !== file.sha256) throw new Error(`Staged hash mismatch: ${file.source}`)
  if (existsSync(file.target) && lstatSync(file.target).isSymbolicLink()) throw new Error(`Linked target refused: ${file.target}`)
}
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ ready: true, stagedFiles: files.length, stagedHashesVerified: true,
    noriStopped: true, installedArchiveUnchanged: true, selectedRuntime: receipt.selectedRuntime,
    requiresElevation: true }))
  process.exit(0)
}
if (existsSync(rollback)) throw new Error(`Existing rollback path preserved: ${rollback}`)
mkdirSync(rollback)
const original = []
for (let index = 0; index < files.length; index++) {
  const file = files[index]
  const backup = join(rollback, `${index}-${file.target.split(/[\\/]/).at(-1)}`)
  if (existsSync(file.target)) {
    copyFileSync(file.target, backup, 1)
    const sha256 = hash(readFileSync(file.target))
    if (hash(readFileSync(backup)) !== sha256) throw new Error('Rollback copy did not verify.')
    original.push({ target: file.target, backup, sha256, existed: true })
  } else original.push({ target: file.target, backup: null, sha256: null, existed: false })
}
writeFileSync(join(rollback, 'before.json'), JSON.stringify({ files: original }, null, 2) + '\n', { flag: 'wx' })

const touched = []
try {
  for (const file of files) {
    const temporary = `${file.target}.chat-routing.tmp`
    if (existsSync(temporary)) throw new Error(`Existing temporary file preserved: ${temporary}`)
    copyFileSync(file.source, temporary, 1)
    if (hash(readFileSync(temporary)) !== file.sha256) throw new Error(`Copy mismatch: ${file.target}`)
    renameSync(temporary, file.target)
    touched.push(file)
  }
  for (const file of files) if (hash(readFileSync(file.target)) !== file.sha256) throw new Error(`Installed file mismatch: ${file.target}`)
  receipt.installed = true
  receipt.installedAt = new Date().toISOString()
  receipt.rollbackCopiesPreserved = true
  receipt.installedFiles = files.map(file => ({ target: file.target, sha256: file.sha256 }))
  writeFileSync(`${receiptPath}.applied.tmp`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  renameSync(`${receiptPath}.applied.tmp`, receiptPath)
  writeFileSync(join(rollback, 'applied.json'), JSON.stringify({ filesVerified: files.length, liveTested: false }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ applied: true, installedFiles: files.length, rollbackCopiesPreserved: true,
    selectedReleaseUnchanged: true, usbModified: false, liveTested: false }))
} catch (error) {
  for (const file of [...touched].reverse()) {
    const previous = original.find(item => item.target === file.target)
    const temporary = `${file.target}.restore.tmp`
    if (previous?.existed) {
      copyFileSync(previous.backup, temporary, 1)
      renameSync(temporary, file.target)
    } else if (existsSync(file.target)) unlinkSync(file.target)
  }
  throw error
}
