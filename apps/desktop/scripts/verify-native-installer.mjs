import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyComponentManifest } from './component-integrity.mjs'

const stem = 'Nori-Native-Suite-Setup-x64'
const slice = new RegExp(`^${stem}-[1-9][0-9]*[a-z]?\\.bin$`)
const verificationTools = ['verify-native-installer.mjs', 'component-integrity.mjs', 'check-native-installer.ps1']
const auxiliary = new Set(['native-installer-receipt.json', ...verificationTools])

// Corruption detection only. Never starts Setup, repairs bytes or authorizes
// deletion of the original source/recovery copy. Receipt is not a signature.
export function verifyNativeInstaller(directory, receipt) {
  const target = resolve(directory), normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  const info = lstatSync(target)
  if (info.isSymbolicLink() || !info.isDirectory() || normalize(realpathSync(target)) !== normalize(target))
    throw Error('Linked or invalid installer directory refused')
  if (!receipt || receipt.schema !== 1 || receipt.compiled !== true || receipt.setupLaunched !== false ||
      typeof receipt.candidate !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(receipt.candidate) ||
      !/^[a-f0-9]{64}$/.test(receipt.installerRecipeSha256 ?? ''))
    throw Error('Invalid native installer build receipt')
  const paths = readdirSync(target).filter(name => !auxiliary.has(name)).sort()
  if (!paths.includes(`${stem}.exe`) || !paths.some(name => slice.test(name)) ||
      !paths.some(name => name === `${stem}-1.bin` || name === `${stem}-1a.bin`) ||
      paths.some(name => name !== `${stem}.exe` && !slice.test(name)))
    throw Error('Installer executable or first disk slice missing, or unexpected output present')
  if (!Array.isArray(receipt.manifest?.files) || receipt.manifest.files.some(file => !file || file.bytes <= 0))
    throw Error('Installer output must be non-empty')
  verifyComponentManifest(target, receipt.manifest, paths)
  verifyComponentManifest(target, receipt.verifierManifest, verificationTools)
  const totalBytes = [...receipt.manifest.files, ...receipt.verifierManifest.files]
    .reduce((sum, file) => sum + file.bytes, 0)
  if (!Number.isSafeInteger(totalBytes) || totalBytes >= 128_000_000_000)
    throw Error('Installer size exceeds the Nori suite limit')
  return { installerIntegrityVerified: true, verifierIntegrityVerified: true, files: paths.length, totalBytes,
    sourceTreeRequired: false, publisherAuthenticated: false, extractionVerified: false,
    installedSuiteVerified: false, releaseVerified: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.versions.electron) process.noAsar = true
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2) throw Error('Usage: verify-native-installer.mjs <installer directory> <receipt.json>')
    const path = resolve(args[1]), info = lstatSync(path)
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
    if (info.isSymbolicLink() || !info.isFile() || info.size === 0 || info.size > 2 * 1024 * 1024 ||
        normalize(realpathSync(path)) !== normalize(path)) throw Error('Unsafe installer receipt')
    const receipt = JSON.parse(readFileSync(path, 'utf8'))
    console.log(JSON.stringify(verifyNativeInstaller(resolve(args[0]), receipt)))
  } catch (error) {
    console.error(JSON.stringify({ verified: false, error: error.message }))
    process.exitCode = 1
  }
}
