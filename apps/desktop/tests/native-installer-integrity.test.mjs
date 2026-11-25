import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildComponentManifest } from '../scripts/component-integrity.mjs'
import { verifyNativeInstaller } from '../scripts/verify-native-installer.mjs'

const stem = 'Nori-Native-Suite-Setup-x64'
function fixture(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'nori-installer-check-'))
  const files = [`${stem}.exe`, `${stem}-1a.bin`, `${stem}-1b.bin`]
  for (const file of files) writeFileSync(join(directory, file), `synthetic bytes ${file}`)
  const tools = ['verify-native-installer.mjs', 'component-integrity.mjs', 'check-native-installer.ps1']
  for (const name of tools) copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(directory, name))
  const receipt = { schema: 1, candidate: 'fixture', compiled: true, setupLaunched: false,
    installerRecipeSha256: 'a'.repeat(64), manifest: buildComponentManifest(directory, files),
    verifierManifest: buildComponentManifest(directory, tools) }
  try { return callback(directory, receipt, files) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('installer verification checks every byte without launching setup or claiming extraction', () => fixture((directory, receipt) => {
  const result = verifyNativeInstaller(directory, receipt)
  assert.equal(result.installerIntegrityVerified, true)
  assert.equal(result.verifierIntegrityVerified, true)
  assert.equal(result.files, 3)
  assert.equal(result.publisherAuthenticated, false)
  assert.equal(result.extractionVerified, false)
  assert.equal(result.installedSuiteVerified, false)
  assert.equal(result.releaseVerified, false)
}))

test('same-size corruption and truncation of any recorded setup piece are rejected', () => {
  for (const at of [0, 1, 2]) fixture((directory, receipt, files) => {
    const file = join(directory, files[at]), original = readFileSync(file)
    const corrupt = Buffer.from(original); corrupt[0] ^= 1
    writeFileSync(file, corrupt)
    assert.throws(() => verifyNativeInstaller(directory, receipt), /integrity mismatch/)
    writeFileSync(file, original.subarray(0, original.length - 1))
    assert.throws(() => verifyNativeInstaller(directory, receipt), /integrity mismatch/)
  })
})

test('missing or extra slices cannot be hidden by the required file list', () => {
  fixture((directory, receipt) => {
    rmSync(join(directory, `${stem}-1b.bin`))
    assert.throws(() => verifyNativeInstaller(directory, receipt), /required components/)
  })
  fixture((directory, receipt) => {
    writeFileSync(join(directory, `${stem}-1c.bin`), 'unexpected extra slice')
    assert.throws(() => verifyNativeInstaller(directory, receipt), /required components/)
  })
  fixture((directory, receipt) => {
    rmSync(join(directory, `${stem}-1a.bin`))
    assert.throws(() => verifyNativeInstaller(directory, receipt), /first disk slice/)
  })
})

test('malformed receipts, empty components and duplicate manifest entries fail closed', () => fixture((directory, receipt) => {
  for (const changes of [{ compiled: false }, { setupLaunched: true }, { candidate: '../escape' },
    { installerRecipeSha256: 'not-a-hash' }]) {
    assert.throws(() => verifyNativeInstaller(directory, { ...receipt, ...changes }), /Invalid/)
  }
  const entry = receipt.manifest.files[0]
  assert.throws(() => verifyNativeInstaller(directory, { ...receipt,
    manifest: { ...receipt.manifest, files: [{ ...entry, bytes: 0 }] } }), /non-empty/)
  assert.throws(() => verifyNativeInstaller(directory, { ...receipt,
    manifest: { ...receipt.manifest, files: [entry, entry, receipt.manifest.files[2]] } }), /required components|Invalid component entry/)
}))

test('slice directories, links and an installer root redirected through a junction are rejected', () => {
  fixture((directory, receipt) => {
    const slice = join(directory, `${stem}-1b.bin`)
    rmSync(slice); mkdirSync(slice)
    assert.throws(() => verifyNativeInstaller(directory, receipt), /regular file/)
  })
  fixture((directory, receipt) => {
    const link = join(directory, 'alias')
    symlinkSync(directory, link, 'junction')
    assert.throws(() => verifyNativeInstaller(link, receipt), /Linked/)
    rmSync(link)
  })
})

test('standalone copied CLI verifies installer bytes without source access and rejects corruption', () => fixture((directory, receipt) => {
  const receiptPath = join(directory, 'native-installer-receipt.json')
  writeFileSync(receiptPath, JSON.stringify(receipt))
  const args = [join(directory, 'verify-native-installer.mjs'), directory, receiptPath]
  let result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).installerIntegrityVerified, true)
  writeFileSync(join(directory, `${stem}-1b.bin`), 'broken')
  result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stderr).verified, false)
}))

test('portable verifier corruption and missing tool metadata are rejected', () => fixture((directory, receipt) => {
  assert.throws(() => verifyNativeInstaller(directory, { ...receipt, verifierManifest: undefined }), /Invalid component manifest/)
  writeFileSync(join(directory, 'component-integrity.mjs'), 'corrupt verifier dependency')
  assert.throws(() => verifyNativeInstaller(directory, receipt), /integrity mismatch/)
}))

function windowsCheck(directory, receipt) {
  const receiptPath = join(directory, 'native-installer-receipt.json')
  writeFileSync(receiptPath, JSON.stringify(receipt))
  // Absolute built-in executable plus empty PATH proves the copied checker
  // doesn't locate Node/Python/Nori or shell out to other programs.
  return spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', join(directory, 'check-native-installer.ps1'),
      '-Directory', directory, '-ReceiptPath', receiptPath], {
      cwd: directory, env: { ...process.env, PATH: '' }, windowsHide: true,
      encoding: 'utf8', timeout: 15000,
    })
}
const windows = { skip: process.platform !== 'win32' }
test('copied Windows PowerShell checker works with no additional runtime on PATH', windows, () => fixture((directory, receipt) => {
  const result = windowsCheck(directory, receipt)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const evidence = JSON.parse(result.stdout)
  assert.equal(evidence.installerIntegrityVerified, true)
  assert.equal(evidence.verifierIntegrityVerified, true)
  assert.equal(evidence.additionalRuntimeRequired, false)
  assert.equal(evidence.installedSuiteVerified, false)
  assert.equal(evidence.extractionVerified, false)
  assert.equal(evidence.totalBytes, verifyNativeInstaller(directory, receipt).totalBytes)
}))

test('Windows checker rejects same-size corruption and truncation of every setup piece', windows, () => {
  for (const at of [0, 1, 2]) fixture((directory, receipt, files) => {
    const file = join(directory, files[at]), original = readFileSync(file)
    const changed = Buffer.from(original); changed[0] ^= 1
    writeFileSync(file, changed)
    let result = windowsCheck(directory, receipt)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(JSON.parse(result.stdout).error, /integrity mismatch/)
    writeFileSync(file, original.subarray(0, original.length - 1))
    result = windowsCheck(directory, receipt)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stdout).error, /size mismatch/)
  })
})

test('Windows checker rejects missing or extra slices and unsafe manifest paths', windows, () => {
  fixture((directory, receipt) => {
    rmSync(join(directory, `${stem}-1b.bin`))
    assert.equal(windowsCheck(directory, receipt).status, 1)
  })
  fixture((directory, receipt) => {
    writeFileSync(join(directory, `${stem}-1c.bin`), 'extra')
    assert.equal(windowsCheck(directory, receipt).status, 1)
  })
  fixture((directory, receipt) => {
    receipt.manifest.files[0].path = '../outside'
    assert.equal(windowsCheck(directory, receipt).status, 1)
  })
})

test('Windows checker rejects forged types and corrupted verifier dependency', windows, () => {
  fixture((directory, receipt) => {
    for (const changes of [{ schema: '1' }, { compiled: 'true' }, { setupLaunched: true }])
      assert.equal(windowsCheck(directory, { ...receipt, ...changes }).status, 1)
    writeFileSync(join(directory, 'component-integrity.mjs'), 'corrupt tool')
    assert.equal(windowsCheck(directory, receipt).status, 1)
  })
})

test('Windows checker refuses an installer root redirected through a junction', windows, () => fixture((directory, receipt) => {
  const link = join(directory, 'alias')
  symlinkSync(directory, link, 'junction')
  try {
    const result = windowsCheck(link, receipt)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stdout).error, /Linked installer paths/)
  } finally { rmSync(link) }
}))
