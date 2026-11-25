// Read-only extraction check. This does not qualify runtime behavior or state migration.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {verifyComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'

const installed = 'C:\\Program Files\\Nori'
const receiptPath = process.argv[2]
if (!receiptPath) throw Error('Provide the verified desktop receipt')
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
if (receipt.schema !== 1 || receipt.packagedPayloadMatches !== true) throw Error('Invalid desktop receipt')
const progress = ({verifiedFiles}) => {
  if (verifiedFiles % 10000 === 0) console.error(`Verified ${verifiedFiles} files`)
}
const desktop = verifyComponentManifest(installed, receipt.desktopManifest, undefined, {onFile:progress})
const suite = join(installed, 'resources/NoriSuite')
const native = verifyComponentManifest(suite, receipt.nativeManifest, nativeDistributionPaths(suite), {onFile:progress})
const expected = new Set(receipt.desktopManifest.files.map(file => file.path))
const extraDesktopFiles = desktopArtifactPaths(installed).filter(path => !expected.has(path))
console.log(JSON.stringify({schema:'nori.installed-payload-byte-check.v1',installed,
  desktop,native,extraDesktopFiles,expectedPayloadBytesVerified:true,
  desktopExtraFilesReviewed:false,runtimeVerified:false,releaseVerified:false}))
