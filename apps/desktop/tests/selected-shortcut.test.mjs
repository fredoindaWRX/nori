import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { windowsSelectedLauncher } from '../scripts/install-desktop-app.mjs'

test('shortcut starts selected packaged app rather than compiling another desktop', () => {
  const body = windowsSelectedLauncher({ root: 'C:\\Nori\\apps\\desktop' })
  assert.match(body, /launch-current-desktop\.vbs/)
  assert.doesNotMatch(body, /cmd\.exe|npm|electron\.exe|vite/i)
  assert.match(body, /NORI_INFERENCE_RUNTIME.*norllama/)
  assert.match(body, /NORI_ALLOW_WRITES.*"0"/)
  assert.match(body, /env\.Remove "ELECTRON_RUN_AS_NODE"/)
})
test('workspace is a quoted environment value, not a shell command', () => {
  const body = windowsSelectedLauncher({ workspace: 'C:\\work "quoted" & other', writes: true })
  assert.match(body, /work ""quoted"" & other/)
  assert.match(body, /NORI_ALLOW_WRITES.*"1"/)
  assert.throws(() => windowsSelectedLauncher({ workspace: 'bad\r\ncommand' }))
  assert.throws(() => windowsSelectedLauncher({ writes: 'true' }))
})

test('Windows executes generated environment setup with quoted workspace and no app launch', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-shortcut-probe-'))
  try {
    const workspace = 'C:\\work "quoted" & other'
    const body = windowsSelectedLauncher({ root, workspace })
    const probe = body.slice(0, body.indexOf('shell.Run ')) +
      'WScript.Echo env("NORI_INFERENCE_RUNTIME")\r\nWScript.Echo env("NORI_ALLOW_WRITES")\r\n' +
      'WScript.Echo env("ELECTRON_RUN_AS_NODE")\r\nWScript.Echo env("NORI_WORKSPACE")\r\n'
    const script = join(root, 'probe.vbs')
    writeFileSync(script, probe)
    const result = spawnSync('cscript.exe', ['//Nologo', script], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NORI_INFERENCE_RUNTIME: 'ollama-rollback', NORI_ALLOW_WRITES: '1' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.stdout.trimEnd().split(/\r?\n/), ['norllama', '0', '', workspace])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('existing stable shortcut launcher enforces native runtime on actual Windows script execution', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-stable-launch-probe-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'release'))
    mkdirSync(join(root, 'release', 'native-desktop-probe', 'win-unpacked'), { recursive: true })
    writeFileSync(join(root, 'release', 'current-desktop.txt'), 'probe')
    writeFileSync(join(root, 'release', 'native-desktop-probe', 'win-unpacked', 'Nori.exe'), 'inspection only')
    const body = readFileSync(new URL('../scripts/launch-current-desktop.vbs', import.meta.url), 'utf8')
    const script = join(root, 'scripts', 'probe.vbs')
    writeFileSync(script, body.replace('WScript.Echo executablePath',
      'WScript.Echo env("NORI_INFERENCE_RUNTIME") & "|" & env("ELECTRON_RUN_AS_NODE") & "|" & env("NORI_ALLOW_WRITES")'))
    const result = spawnSync('cscript.exe', ['//Nologo', script, '--inspect'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NORI_INFERENCE_RUNTIME: 'ollama-rollback', NORI_ALLOW_WRITES: 'bad' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'norllama||0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
