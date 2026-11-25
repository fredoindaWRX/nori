import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('native verification refuses missing credentials without initializing storage', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nori-location-read-only-'))
  const credentialRoot = join(root, 'Nori', 'location-private')
  const script = fileURLToPath(new URL('./launch-private.ps1', import.meta.url))
  try {
    for (const exists of [false, true]) {
      if (exists) await mkdir(credentialRoot, { recursive: true })
      const child = spawnSync('powershell.exe', ['-NoProfile', '-File', script, '-VerifyNative'], {
        env: { ...process.env, LOCALAPPDATA: root }, encoding: 'utf8', timeout: 10000, windowsHide: true,
      })
      assert.equal(child.error, undefined)
      assert.notEqual(child.status, 0)
      assert.match(child.stderr, /Verification requires existing pairing credentials/)
      await assert.rejects(access(join(credentialRoot, 'credentials.clixml')))
      if (!exists) await assert.rejects(access(credentialRoot))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
